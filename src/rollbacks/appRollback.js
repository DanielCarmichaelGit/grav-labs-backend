const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const dbConnect = require("./src/utils/dbConnect");
const User = require("./src/models/user");
const User_Config = require("./src/models/userConfig");
const Integration = require("./src/models/integration");
const { v4: uuidv4 } = require("uuid");

const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.options("*", cors()); // Enable CORS pre-flight request for all routes
app.use(express.json());

async function utility(new_user) {
  dbConnect(process.env.MONGODB_API);
  const userCollectionName = `userCollection_${new_user.associative_id}`;

  const db = mongoose.connection.db;
  await db.createCollection(userCollectionName);
}

app.get("/", (req, res) => {
  console.log("received home");
  return res.status(200).json({ message: "working" });
});

// this endpoint uses the "auth" auth
app.post("/login", async (req, res) => {
  dbConnect(process.env.MONGODB_AUTH);
  console.log(req);

  const { email, password } = req.body;
  const user = await User.findOne({ email });
  console.log("-----------------");
  console.log(user);
  console.log("-----------------");

  console.log(bcrypt.compareSync(password, user.password));

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ message: "Authentication failed" });
  }

  const token = jwt.sign({ userId: user._id }, "secret", { expiresIn: "1h" });
  res.json({
    user_id: user._id,
    token,
    email: user.email,
    name: user.full_name,
  });
});

// this endpoint uses the user management auth
app.get("/user-config", async (req, res) => {
  try {
    await dbConnect(process.env.MONGODB_USERS);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// this endpoint uses the user management auth
app.post("/user_config", async (req, res) => {
  const { email, full_name, configs, payment, associated_id } = req.body; // req.body, not req

  try {
    await dbConnect(process.env.MONGODB_USERS).then((res) => {
      console.log("connection console log ", res);
    });

    // findOne returns a query, you need to execute it to get the data
    console.log("attempting to find existing config");
    const existing_config = await User_Config.findOne({ email });
    console.log("config search complete");
    console.log("existing config: ", existing_config);

    if (existing_config) {
      // Update the existing document
      existing_config.full_name = full_name;
      existing_config.configs = configs;
      existing_config.payment = payment;
      await existing_config.save();
      res.status(200).json({ message: "user config updated" });
    } else {
      // Create new document
      const user_config = new User_Config({
        email,
        full_name,
        configs,
        payment,
        associated_id,
      });
      await user_config.save();
      res.status(201).json({ message: "user config saved" });
    }
  } catch (error) {
    console.log("there was an error creating the authentication");
    res.status(500).json({ message: error.message });
  }
});

// this endpoint uses the base auth
app.post("/signup", async (req, res) => {
  console.log("Received signup", req.body); // Log incoming request
  const { email, password, full_name } = req.body;
  const user_id = uuidv4();

  
  console.log("##############################");
  console.log("Attempting to sign up user");
  console.log("##############################");
  
  try {
    await dbConnect(process.env.MONGODB_AUTH).then((res) => {
      console.log("database connection established");
    });
    
    res.status(200).json({ message: "received" });
    console.log("##############################");
    console.log("Connected to DB");
    console.log("##############################");

    const existing_user = await User.findOne({ email });

    console.log("##############################");
    console.log("Search for user completed");
    console.log("##############################");

    if (existing_user) {
      res.status(204).json({ message: "user already exists" });
    } else {
      const user = new User({
        email,
        password,
        full_name,
        associated_id: user_id,
      });
      await user.save();

      console.log("##############################");
      console.log("User saved");
      console.log("##############################");

      await utility(user);

      try {
        // connect to config auth and force a reconnect
        await dbConnect(process.env.MONGODB_USERS);

        console.log("##############################");
        console.log("New DB connection succeeded");
        console.log("##############################");

        // search configs for existing config by user email
        const existing_config = await User_Config.findOne({ email });

        console.log("##############################");
        console.log("Search for existing config completed");
        console.log("##############################");

        if (!existing_config) {
          // Create new config document
          const user_config = new User_Config({
            email,
            full_name,
            configs: {},
            payment: {
              status: "trial",
              plan_start_date: "",
              plan_end_date: "",
              invoice_id: "",
              stripe_customer_id: "",
              period: "monthly",
              plan_id: "trial",
              discount_code: "",
              usage: {
                period_start: "",
                period_end: "",
                usage: 1,
              },
            },
            associated_id: user.associated_id,
          });
          await user_config.save();

          console.log("##############################");
          console.log("User config saved");
          console.log("##############################");

          res.status(201).json({ message: "user config saved" });
        } else {
          // Update the existing document
          existing_config.full_name = full_name;
          existing_config.configs = configs;
          existing_config.payment = payment;
          await existing_config.save();
          res.status(200).json({ message: "user config updated" });
        }
      } catch (error) {
        console.log("couldn't save configs");
        res
          .status(500)
          .json({ message: `failed to insert user configs: ${error.message}` });
      }
      res.status(201).json({ message: "User registered" });
    }
  } catch (error) {
    console.error("Signup failed:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.post("/test", async (req, res) => {
  console.log("Received test", req.body); // Log incoming request
  try {
    await dbConnect(process.env.MONGODB_AUTH);
    console.log("db connected");
    res.json(req.body); // Send the request body back as response
  } catch (error) {
    console.error("Test failed:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.post("/send-email-join-team", async (req, res) => {
  const { email, comment } = req.body;

  // create reusable transporter object using the default SMTP transport
  const transporter = nodemailer.createTransport({
    service: "gmail", // You can use other services like Yahoo, Outlook, etc.
    auth: {
      user: "devconnect.careers@gmail.com", // your email
      pass: process.env.EMAIL_AUTH, // your email password
    },
  });

  // setup email data
  const mailOptions = {
    from: email,
    to: "devconnect.careers@gmail.com", // your email to receive messages
    subject: "Join Team Request",
    text: comment,
  };

  // send email
  try {
    await transporter.sendMail(mailOptions);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to send the email:", error);
    res.json({ success: false });
  }
});

app.get("/integrations/:integration_name", async (req, res) => {
  try {
    await dbConnect(process.env.GEN_AUTH);
    const integration_name = req.params.integration_name;
    console.log(integration_name);
    console.log("Connection Established");
    const integrations = await Integration.find({
      integration_name: {
        $regex: integration_name,
        $options: "i",
      },
    });
    console.log("integrations", integrations);
    res.status(200).json({ data: integrations });
    console.log(res);
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  } finally {
    // Close the database connection if required
  }
});

app.get(`/integrations`, async (req, res) => {
  try {
    await dbConnect(process.env.GEN_AUTH);
    console.log("Connection Established");
    const integrations = await Integration.find();
    res.status(200).json({ data: integrations });
  } catch (error) {
    res.status();
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
