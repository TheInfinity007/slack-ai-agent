import pg from 'pg';

const { Pool } = pg;
import dotenv from 'dotenv';
import { idleTimeoutMillis } from 'pg/lib/defaults';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,   // close idle connections
    connectionTimeoutMillis: 2000
});

pool.on('connect', () => {
    console.log('[INFO] Database connected');
})

pool.on('error', (err) => {
    console.error('[ERROR] Unexpected database error:', err.message);
});

export async function initDatabase() {
    const client = await pool.connect();

    try {
        await client.query(`
            
            CREATE TABLE IF NOT EXISTS member_analyses (
                id SERIAL PRIMARY KEY,
                member_id VARCHAR(255),
                member_name VARCHAR(255) NOT NULL,
                member_email VARCHAR(255),
                member_title VARCHAR(255),
                member_timezone VARCHAR(100),
                fit_score INTEGER NOT NULL,
                insights JSONB,
                recommendations JSONB,
                research_data JSONB,
                analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                sent_to_slack BOOLEAN DEFAULT FALSE,
                sent_to_slack_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            `)
    } catch (err) {
        console.error('[ERROR] Failed to initialize databaes:', err.message);
        throw error;
    } finally {
        client.release();
    }
}