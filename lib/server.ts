import express from 'express';
import { logDebug } from './logger';
import moment from 'moment';

const app = express();
const PORT = 3000;  // You can change this port

// Health check endpoint
app.get('/ping', (req, res) => {
    logDebug(
        'SERVER',
        'HEALTH_CHECK',
        'SYSTEM',
        'Ping received',
        {
            timestamp: moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS'),
            remote_ip: req.ip
        }
    );
    res.send('pong');
});

// Start server
export function startServer() {
    app.listen(PORT, () => {
        logDebug(
            'SERVER',
            'START',
            'SYSTEM',
            'Health check server started',
            {
                port: PORT,
                timestamp: moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss.SSS')
            }
        );
    });
} 