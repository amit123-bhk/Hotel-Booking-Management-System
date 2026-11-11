const app = require('./app');
const { connectDb } = require('./db/database');
const { seed } = require('./db/seed');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await connectDb();
    await seed();

    app.listen(PORT, '0.0.0.0', () => {
      const dbName = process.env.MONGODB_DB_NAME || 'grand_horizon_hotel';
      console.log('=======================================================');
      console.log(' Grand Horizon Hotel Management & Booking Platform');
      console.log(` Listening on port: ${PORT}`);
      console.log(` Local URL: http://localhost:${PORT}`);
      console.log(` Health Check: http://localhost:${PORT}/api/health`);
      console.log(` Database: MongoDB (${dbName})`);
      console.log('=======================================================');
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
