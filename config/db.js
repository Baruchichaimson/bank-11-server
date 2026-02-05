import mongoose from 'mongoose';

const DEFAULT_MONGO_URI = 'mongodb://127.0.0.1:27017/bank-11';

const connectMongoDB = async () => {

   const mongoUri = process.env.MONGO_URI || DEFAULT_MONGO_URI;
  try 
  {
    await mongoose.connect(mongoUri);
    console.log('MongoDB connected successfully');
  } 
  catch (error) 
  {
    console.error('MongoDB connection error:', error.message);

    if (error.code === 'ECONNREFUSED') 
    {
      console.error(
        'MongoDB refused the connection. Ensure the database is running and accessible, ' +
          `or update MONGO_URI. Current URI: ${mongoUri}`
      );
    } 
    else if (error.message?.includes('replicaSet')) 
    {
      console.error(
        'The configured MONGO_URI expects a replica set. Start MongoDB with the replica set ' +
          'enabled or remove the replicaSet query param.'
      );
    } 
    else 
    {
      console.error(`Check that the MONGO_URI is valid. Current URI: ${mongoUri}`);
    }
    process.exit(1);
  }
};

export default connectMongoDB;
