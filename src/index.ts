import express from 'express';
import { config } from 'dotenv';
import fileUpload from 'express-fileupload';

import routes from './routes';

config();
const app = express();

app.use(fileUpload());
app.use(express.json());
app.use('/', routes);

// Add global error handler to silence request.aborted errors
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === 'request.aborted' || err.message === 'request aborted') {
    return res.status(400).send({ reason: 'Request aborted by client' });
  }
  next(err);
});

const SERVER_PORT = parseInt(process.env.PORT || process.env.SERVER_PORT || '8080', 10);

app.listen(SERVER_PORT, () => {
  console.log('Application started on port ' + SERVER_PORT);
});