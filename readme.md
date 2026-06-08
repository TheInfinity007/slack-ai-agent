# Slack AI Member Analysis Agent

A lightweight Slack bot that automatically analyzes new team members and posts AI-generated hiring fit and engagement recommendations back to Slack.

Built using Slack Bolt, LangChain, and PostgreSQL, this agent helps teams capture member intelligence, track analysis results, and keep people operations aligned with product fit.

---

## Key Features

- Automatically responds to Slack `team_join` and `member_joined_channel` events
- Fetches Slack user profile data and performs external research using email domain and GitHub search
- Generates structured analysis using OpenAI, Google Gemini, or Groq LLM providers
- Stores analysis results in PostgreSQL with tracking metadata
- Posts rich Slack messages with fit score, insights, and engagement recommendations
- Includes a development-only test endpoint for validating the analysis pipeline

## Tutorial

A walkthrough video demonstrating setup and usage:

https://youtu.be/MnG0ugK2JAI?t=2342

---

## Screenshot / Demo

A sample Slack analysis message and database reference are shown below.

![Slack member analysis screenshot](./assets/slack-analysis.png)

> Optional: add a database schema or ERD screenshot here for internal reference.

![Database schema screenshot](./assets/database-schema.png)

> Optional: a cropped row or table screenshot for quick-reference view.

![Database row screenshot](./assets/database-row.png)

---

## Getting Started

### Prerequisites

- Node.js 24+ installed
- PostgreSQL database accessible via a connection string
- Slack app configured with bot token, app token, and signing secret
- One of the supported LLM providers configured:
  - OpenAI
  - Google Gemini
  - Groq

### Install dependencies

```bash
npm install
```

### Environment variables

Create a `.env` file in the project root with the following values:

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_PRIVATE_CHANNEL_ID=C0123456789
DATABASE_URL=postgresql://user:password@host:port/database
LLM_PROVIDER=openai
OPENAI_API_KEY=your-openai-key
# GOOGLE_API_KEY=your-google-key
# GROQ_API_KEY=your-groq-key
COMPANY_NAME=Your Company
COMPANY_PRODUCT=Your Product
PORT=3000
NODE_ENV=development
```

### Run the app

```bash
npm start
```

For development mode with automatic reload:

```bash
npm run dev
```

---

## How It Works

1. The bot listens for Slack events using Bolt in socket mode.
2. When a new user joins the workspace or a channel, it fetches Slack profile data.
3. It performs lightweight research on the member using email domain and GitHub search.
4. The agent sends the collected data to an LLM prompt for fit scoring, insights, and recommendations.
5. The result is saved in PostgreSQL and posted to the configured Slack channel.

---

## Development Testing

When `NODE_ENV=development`, the app exposes a test endpoint:

```http
POST /test/analyse-member
```

Request body example:

```json
{
  "memberInfo": {
    "id": "U1234567",
    "name": "Jane Doe",
    "email": "jane.doe@example.com",
    "title": "Product Manager",
    "timezone": "America/Los_Angeles"
  }
}
```

This allows you to validate the analysis pipeline without waiting for Slack events.

---

## Database

The project uses PostgreSQL and creates a `member_analyses` table with columns such as:

- `member_id`
- `member_name`
- `member_email`
- `fit_score`
- `insights`
- `recommendations`
- `research_data`
- `sent_to_slack`
- `analyzed_at`

> Add database schema or screenshot here.

---

## Notes

- Avoid using personal emails for research. The agent ignores emails from common personal domains.
- Ensure the Slack bot has permissions to read user profiles and post messages.
- Confirm the Slack app is running in socket mode and that the app token is valid.

---

## License

This project is released under the ISC License.
