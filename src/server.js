const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const app = require('./app');
const { initDB } = require('./config/db');

const port = process.env.PORT || 443;

const sslOptions = {
    key: fs.readFileSync(path.join(__dirname, '../key.pem')),
    cert: fs.readFileSync(path.join(__dirname, '../cert.pem'))
};

initDB().then(() => {
    // HTTPS Server
    https.createServer(sslOptions, app).listen(port, '0.0.0.0', () => {
        console.log(`[${new Date().toISOString()}] Secure Server running at https://0.0.0.0:${port}`);
    });

    // HTTP to HTTPS Redirect
    http.createServer((req, res) => {
        const host = req.headers['host'];
        if (host) {
            const cleanHost = host.split(':')[0];
            res.writeHead(301, { "Location": "https://" + cleanHost + req.url });
        } else {
            res.writeHead(400);
        }
        res.end();
    }).listen(80, '0.0.0.0', () => {
        console.log(`[${new Date().toISOString()}] HTTP Redirect Server running at http://0.0.0.0:80`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
