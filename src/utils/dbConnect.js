const mongoose = require("mongoose");
const connections = {};

// Function to establish a database connection
async function dbConnect(auth) {
  // Check if we have a connection to the database or if it's currently
  // connecting or disconnecting (in which case we don't want to initiate a new connection)
  if (mongoose.connection.readyState === 1 && connections[auth]) {
    return;
  }

  // Connection URI
  const dbURI = auth;

  console.log("database uri", dbURI);

  try {
    // Connect to MongoDB
    const connection = await mongoose.connect(dbURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      poolSize: 10,
      useFindAndModify: false,
    });

    connections[auth] = connection;
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("Error connecting to MongoDB", error);
    throw error; // Rethrow the error for calling functions to handle
  }

  mongoose.connection.on("error", (err) =>
    console.error("MongoDB error:", err)
  );
  mongoose.connection.on("disconnected", () =>
    console.log("MongoDB disconnected")
  );
  mongoose.connection.on("reconnected", () =>
    console.log("MongoDB reconnected")
  );
}

module.exports = dbConnect;
