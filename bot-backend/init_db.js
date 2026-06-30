const { Client } = require('pg');

const connectionString = "postgresql://vashu:p--idOQQkxIUPudLXwZ9TQ@copper-orca-28396.j77.aws-ap-south-1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full";

async function initDB() {
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log("Connected to CockroachDB.");

        // Create Users Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(255) PRIMARY KEY,
                role VARCHAR(50) NOT NULL,
                status VARCHAR(50) NOT NULL
            );
        `);
        console.log("Users table ready.");

        // Create Properties Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS properties (
                id VARCHAR(255) PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                price VARCHAR(100) NOT NULL,
                location VARCHAR(255) NOT NULL,
                description TEXT,
                other_info TEXT,
                images JSONB,
                documents JSONB,
                agent_id VARCHAR(255) NOT NULL,
                agent_name VARCHAR(255),
                agent_phone VARCHAR(100)
            );
        `);
        console.log("Properties table ready.");

    } catch (err) {
        console.error("Error initializing DB:", err);
    } finally {
        await client.end();
        console.log("Connection closed.");
    }
}

initDB();
