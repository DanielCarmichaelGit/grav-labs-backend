const mongoose = require("mongoose");
const connections = {};
// check the connection obj to see what it is containing

const dbConnect = async (auth) => {
  console.log("existing connections", connections);
  // Check if a connection for this auth already exists
  if (connections[auth] && connections[auth].readyState === 1) {
    console.log("Using existing connection for this auth.");
    return connections[auth];
  }
  else {
    console.log("Creating new connection")
  }

  // Connection options
  const options = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    poolSize: 10,
    socketTimeoutMS: 45000,
    keepAlive: true,
    keepAliveInitialDelay: 300000
  };

  // Attempt to create a new connection for this auth
  try {
    console.log(`Connecting to MongoDB with auth: ${auth}`);
    const connection = await mongoose.createConnection(auth, options)

    console.log("#########################################")
    console.log("NEW CONNECTION", connection)
    console.log("#########################################")

    // Add 'disconnected' event listener to the connection
    connection.on('disconnected', () => {
      console.log(`Connection with auth ${auth} disconnected.`);
      delete connections[auth];
    });
    
    // Store the new connection in the connections object
    connections[auth] = connection;
    console.log("existing connections", connections);

    console.log("Successfully connected to MongoDB with new auth.");
    console.log("This does run");
    return connection;
  } catch (error) {
    console.error("Error connecting to MongoDB: ", error);
    if (error.reason && error.reason.message) {
      console.error("Detailed MongoDB connection error: ", error.reason.message);
    }
    // Consider re-throwing the error or handling it appropriately
  }
};

module.exports = dbConnect;
