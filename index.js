import { App } from '@slack/bolt';

import { WebClient } from '@slack/web-api';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';

import { initDatabase, closeDatabase, saveMemberAnalysis, markAsSentToSlack } from './db.js'


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
            analysisId = await saveMemberAnalysis(memberInfo, analysis, researchData);

            // 4. Post the analysis to the appropriate slack channel
            await this.postAnalysisToChannel(memberInfo, analysis, researchData);

            // 5. Update the db recoreds to mark the analysis as sent to slack
            if (analysisId) {
                await markAsSentToSlack(analysisId);
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
            if (memberInfo.email && !this.isPersonalEmail(memberInfo.email)) {
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
            log.error(`Research error inside doBasicResearch:`, error.message);
        }
        return result;
    }

    async getCompanyInfo(domain) {
        try {
            const response = await axios.get(`https://www.${domain}`, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } });

            const titleMatch = response.data.match(/<title>(.*?)<\/title>/i);
            const title = titleMatch ? titleMatch[1] : `Company: ${domain}`;

            return {
                url: `https://www.${domain}`,
                title,
                content: `Company website for ${domain}`,
                type: 'company',
            };
        } catch (error) {
            log.error(`Could not fetch company info for domain ${domain}:`, error.message);
            return null;
        }
    }

    async getGithubInfo(name) {
        try {
            const searchResponse = await axios.get(`https://api.github.com/search/users?q=${encodeURIComponent(name)}`, { timeout: 5000 });
            const user = searchResponse.data.items?.[0];

            if (user) {
                // const userResponse = await axios.get(`https://api.github.com/users/${user.login}`, { timeout: 5000 });
                return {
                    url: user.html_url,
                    title: `GitHub: ${user.login}`,
                    // content: userResponse.data.bio || `GitHub profile for ${name}`,
                    content: `${user.public_repos} public repositories`,
                    type: 'github',
                };
            }
            return null;
        } catch (error) {
            log.debug(`GitHub search error:`, error.message);
        }
        // return null if no github profile found or on error to avoid blocking the analysis
        return null;
    }

    async analyseWithAI(memberInfo, researchData) {
        const promopt = ChatPromptTemplate.fromTemplate(
            `Analyse this new community member for fit with our commercial product.
            
            Company: ${process.env.COMPANY_NAME || 'Your Company'}
            Product: ${process.env.COMPANY_PRODUCT || 'Your Product'}

            Member:
            - Name: {name}
            - Email: {email}
            - Title: {title}

            Research Data: {research}

            Provide a. JSON response with:
            - fitScore (0-100): likelihood they'd be interested in our product
            - insights: array of 3-5 key observations
            - recommendations: array of 2-4 engagement suggestions

            Consider job title, company size, technical background, and budget authority.
            `
        );

        try {
            const researchSummary = researchData.length > 0 ?
                researchData.map(r => `${r.title}: ${r.content}`).join(`\\n`)
                : 'limited research data available';

            const chain = prompt.pipe(this.openai);

            const result = await chain.invoke({
                name: memberInfo.name,
                email: memberInfo.email || 'Not Provided',
                title: memberInfo.title || 'Not Provided',
                research: researchSummary,
            })

            const responseText = result.content || result;

            // String markdown content
            const cleanedResponse = responseText.replace(/```json\\n|\\n?```/g, '').trim();

            const analysis = JSON.parse(cleanedResponse);

            return {
                fitScore: Math.max(0, Math.min(100, analysis.fitScore || 50)),
                insights: Array.isArray(analysis.insights) ? analysis.insights : ['Analysis completed'],
                recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations : ['Follow up recommended'],
            };
        } catch (error) {
            log.error(`AI Analysis error: ${error.message}`)
            return {
                fitScore: 50,
                insights: ['unabled to complete full analysis'],
                recommendations: ['Manual review recommended'],
            }
        }
    }

    async postAnalysisToChannel(memberInfo, analysis, researchData) {

        const color = analysis.fitScore >= 80 ? '#36a64f' :
            analysis.fitScore >= 60 ? '#ffb84d' :
                analysis.fitScore >= 40 ? '#ff9500' : '#ff4444';


        const blocks = [
            {
                type: 'header',
                text: { type: 'plain_text', text: `🔍 New Member: ${memberInfo.name} (${memberInfo.title})` }
            },
            {
                type: 'section',
                fields: [
                    { type: 'mrkdwn', text: `*Fit Score:*${analysis.fitScore}/100` },
                    { type: 'mrkdwn', text: `*Email:*${memberInfo.email || 'Not Provided'}` },
                    { type: 'mrkdwn', text: `*Title:*${memberInfo.title || 'Not Provided'}` },
                ]
            }
        ]

        if (analysis.insights.length > 0) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn', text: `*Insights:*\\n${analysis.insights.map(i =>
                        `• ${i}`
                    ).join('\\n')}`
                }
            })
        }

        if (analysis.recommendations.length > 0) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn', text: `*Recommendations:*\\n${analysis.recommendations.map(r =>
                        `• ${r}`
                    ).join('\\n')}`
                }
            })
        }

        blocks.push({
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: `📊 Analysed: ${new Date().toISOString()}`
                }
            ]
        })

        await this.webClient.chat.postMessage({
            channel: process.env.SLACK_PRIVATE_CHANNEL_ID,
            text: `New Member Analysis: ${memberInfo.name} (${analysis.fitScore}/100)`,
            blocks
        })

        log.info(`Analysis posted to slack channel for ${memberInfo.name}`);
    }

    isPersonalEmail(email) {
        const personalDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'];
        const domain = email.split('@')[1]?.toLowerCase();
        return personalDomains.includes(domain);
    }

    async start() {
        try {
            log.info(`🗄️ Initializing database...`);
            await initDatabase();

            const port = process.env.PORT || 3000;
            this.server = this.app.listen(port, () => {
                log.info(`🚀 Express server running on port ${port}`);
            });

            await this.slack.start();
            log.info(`⚡ Slack Bolt app started in ${process.env.NODE_ENV || 'production'} mode`);

            log.info(`✅ Slack AI Agent is up and running! Waiting for new members...`);

            if (process.env.NODE_ENV === 'development') {
                log.info(`🔧 Development mode: You can test the analysis pipeline by sending a POST request to /test/analyse-member with a JSON body containing memberInfo.`);
                log.info(`Test endpoint: POST http://localhost:${port}/test/analyse-member`);
            }
        } catch (error) {
            log.error(`Failed to start:`, error.message);
            process.exit(1);
        }
    }

    async stop() {
        log.info(`Shutting down Slack AI Agent...`);

        try {
            await this.slack.stop();
            if (this.server) {
                await new Promise(resolve => this.server.close(resolve));
            }

            await closeDatabase();

            log.info(`Shutdown complete. Goodbye!`);
            process.exit(0);
        } catch (error) {
            log.error(`Error during shutdown:`, error.message);
            process.exit(1);
        }
    }

}


const agent = new SlackAIAgent();

process.on('SIGINT', () => agent.stop());
process.on('SIGTERM', () => agent.stop());

agent.start().catch(error => {
    console.error('Startup failed:', error.message);
    process.exit(1);
});

export default agent;


