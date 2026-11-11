const app = require('./app');
const { connectDb } = require('./db/database');
const { seed } = require('./db/seed');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await connectDb();
    await seed();

    app.listen(PORT, () => {
      console.log('=======================================================');
      console.log(' Grand Horizon Hotel Management & Booking Platform');
      console.log(` Running on: http://localhost:${PORT}`);
      console.log(` Interactive API Docs: http://localhost:${PORT}/api/docs`);
      console.log(` Health Check: http://localhost:${PORT}/api/health`);
      console.log(' Database: MongoDB (127.0.0.1:27017)');
      console.log('=======================================================');
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
