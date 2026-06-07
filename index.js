import { App } from '@slack/bolt';

import { WebClient } from '@slack/web-api';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core';
import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';

// Read environment variables from .env file
dotenv.config();

// Simple logger utility object
const log = {
    info: (msg, ...args) => console.log(`INFO: ${msg}`, ...args),
    error: (msg, ...args) => console.error(`ERROR: ${msg}`, ...args),
    debug: (msg, ...args) => process.env.NODE_ENV === 'development' && console.debug(`DEBUG: ${msg}`, ...args)
}


class SlackAIAgent {
    constructor() {
        this.app = express();
        this.slack = new App({
            token: process.env.SLACK_BOT_TOKEN,
            signingSecret: process.env.SLACK_SIGNING_SECRET,
            socketMode: true,
            appToken: process.env.SLACK_APP_TOKEN,
        });

        // Standalone Slack web client for direct API calls outside of Bolt's event system
        this.webClient = new WebClient(process.env.SLACK_BOT_TOKEN);

        // Initialize the LangChain OpenAI chat model gpt4, low temperature for consistent output
        this.openai = new ChatOpenAI({
            model: "gpt-4",
            temperature: 0.3,
            apiKey: process.env.OPENAI_API_KEY,
        })

        // Register slack event listener
        this.setupSlackEvent();
        this.setupExpress();
    }

    setupSlackEvent() {
        this.slack.event('team_join', async ({ event }) => {
            try {
                log.info(`New user joined: ${event.user.real_name || event.user.name}`);

                const userInfo = await this.getUserInfo(event.user.id);

                // Run the analysis pipeline and push events to slack
                await this.analyseAndPostMember(userInfo);
            } catch (error) {
                log.error(`Error processing team_join:`, error.message);
            } ˀ
        });

        this.slack.event('member_joined_channel', async ({ event }) => {
            try {
                if (event.channel_type === 'C') {
                    // Public channel
                    log.info(`member ${event.user} joined channel ${event.channel}`);

                    const userInfo = await this.getUserInfo(event.user);

                    // Run the analysis pipeline and push events to slack
                    await this.analyseAndPostMember(userInfo);
                }

                const userInfo = await this.getUserInfo(event.user);

                // Run the analysis pipeline and push events to slack
                await this.analyseAndPostMember(userInfo);
            } catch (error) {
                log.error(`Error processing member_joined_channel:`, error.message);
            }
        });

        this.slack.error(async (error) => log.error('Slack Bolt error:', error.message));
    }

    setupExpress() {
        this.app.use(express.json());

        this.app.get('/health', (req, res) => {
            res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
        });

        if (process.env.NODE_ENV === 'development') {
            this.app.post('/test/analyse-member', async (req, res) => {
                try {
                    const { memberInfo } = req.body;

                    if (!memberInfo) {
                        return res.status(400).json({ error: 'MemberInfo is required' });
                    }

                    const analysis = await this.analyseAndPostMember(memberInfo);

                    res.status(200).json({ success: true, analysis, timestamp: new Date().toISOString() });
                } catch (error) {
                    log.error('Test analysis-error:', error.message);
                    res.status(500).json({ error: 'Analysis failed', message: error.message });
                }
            });
        }

        // Error handling middleware
        this.app.use((err, req, res, next) => {
            log.error('Express error:', err.message);
            res.status(500).json({ error: 'Internal Server Error', message: err.message });
        });
    }

    async getUserInfo(userId) {
        try {
            const response = await this.webClient.users.info({ user: userId });
            const user = response.user;

            const userInfo = {
                id: user.id,
                name: user.real_name || user.name,
                username: user.name,
                email: user.profile?.email,
                title: user.profile?.title,
                timezone: user.tz,
                profile: {
                    firstName: user.profile?.first_name,
                    lastName: user.profile?.last_name,
                    statusText: user.profile?.status_text,
                }
            }
            return userInfo;
        } catch (error) {
            log.error(`Failed to fetch user info for ${userId}:`, error.message);
            throw new Error('Could not retrieve user information');
        }
    }

    async analyseAndPostMember(memberInfo) {
        let analysisId = null;

        try {
            log.info(`Processing member: ${memberInfo.name}`);

            // 1. Fetch the user data from github
            const researchData = await this.doBasicResearch(memberInfo);

            // 2. Send the research data to gpt4 for fit analysis
            const analysis = await this.analyseWithAI(memberInfo, researchData);

            log.info(`Saving analysis to database for member ${memberInfo.name}`);

            // 3. Save the analysis to the database and get the analysis ID
            analysisId = await this.saveMemberAnalysis(memberInfo, analysis, researchData);

            // 4. Post the analysis to the appropriate slack channel
            await this.postAnalysisToChannel(memberInfo, analysis, researchData);

            // 5. Update the db recoreds to mark the analysis as sent to slack
            if (analysisId) {
                await this.markAsSentToSlack(analysisId);
            }
        } catch (error) {
            log.error(`Error processing member ${memberInfo.name}:`, error.message);
            if (analysisId) {
                log.info(`Analysis ${analysisId} saved to databse but not sent to Slack due to error.`);
            }
            throw error;
        }
    }

    async doBasicResearch(memberInfo) {
        const result = [];

        try {
            if (memberInfo.email && !this.personalEmail(memberInfo.email)) {
                const domain = memberInfo.email.split('@')[1];
                const companyInfo = await this.getCompanyInfo(domain);
                if (companyInfo) {
                    result.push(companyInfo);
                }

                if (memberInfo.name) {
                    const githubInfo = await this.getGithubInfo(memberInfo.name);
                    if (githubInfo) {
                        result.push(githubInfo);
                    }
                }
            }
        } catch (error) {
            log.error(`Research error:`, error.message);
        }
    }
}


