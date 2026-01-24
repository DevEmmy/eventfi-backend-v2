import express from 'express';
import v1Routes from './v1/routes';
import cors from 'cors';

const app = express();

app.use(cors({
    origin: 'http://localhost:3000',
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/v1', v1Routes);

export default app;
