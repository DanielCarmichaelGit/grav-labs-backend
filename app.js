const express = require("express");
const cors = require("cors");

// import utility functions
const dbConnect = require("./src/utils/dbConnect");

// import packages
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const sgTransport = require("nodemailer-sendgrid-transport");
const bcrypt = require("bcrypt");

// Secret key for JWT signing (change it to a strong, random value)
const SECRET_JWT = process.env.SECRET_JWT;

// import models
const User = require("./src/models/user");
const Organization = require("./src/models/organization");
const Task = require("./src/models/task");
const Sprint = require("./src/models/sprint");
const Alert = require("./src/models/alerts");

const app = express();
app.use(cors());
app.options("*", cors()); // Enable CORS pre-flight request for all routes
app.use(express.json());

// create utility transporter for email service
const transporter = nodemailer.createTransport(
  sgTransport({
    auth: {
      api_key: process.env.SG_API_KEY, // Replace with your SendGrid API key
    },
  })
);

function authenticateJWT(req, res, next) {
  console.log("Request!", req);
  const token = req.header("Authorization");

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  jwt.verify(token, SECRET_JWT, (error, user) => {
    if (error) {
      return res.status(403).json({ message: "Token is invalid" });
    }

    req.user = user;
    next();
  });
}

async function comparePassword(plaintextPassword, hashedPassword) {
  return bcrypt.compare(plaintextPassword, hashedPassword);
}

// test endpoint to verify server status
app.get("/", (req, res) => {
  console.log("received home");
  return res.status(200).json({ message: "working" });
});

//###########################################################################
// Add a POST endpoint for user registration (signup)
app.post("/signup", async (req, res) => {
  try {
    await dbConnect(process.env.GEN_AUTH);
    const { password, email, organization, type, first_name, last_name } =
      req.body; // Add jam_group

    // Check if the username already exists
    const existingUser = await User.findOne({ email });

    // if existing user, early return
    if (existingUser) {
      return res.status(409).json({
        message: "Username already exists",
        redirect: { url: "google.com" },
      });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const user_id = uuidv4();
    const org_id = uuidv4();
    const task_id = uuidv4();
    const alert_id = uuidv4();
    const sprint_id = uuidv4();

    //Create a jam group for this new user
    const newUser = new User({
      user_id,
      email,
      password: hashedPassword,
      name: {
        first: first_name,
        last: last_name,
      },
      organization: {},
      kpi_data: {},
      tasks: [],
      type,
      sprints: [sprint_id],
      marketable: true,
    });

    // create new org
    const newOrg = new Organization({
      org_id,
      name: organization,
      admins: [],
      members: [],
      seats: 2,
      status: "active",
      billable_user: {
        email: newUser.email,
        user_id: newUser.user_id,
      },
      billing: {},
      sprints: [sprint_id],
    });

    // create first task
    const firstTask = new Task({
      task_id,
      title: "Getting Started",
      assigned_by: {
        email: "danielfcarmichael@gmail.com",
      },
      assignees: [newUser.email],
      status: "Not Started",
      escalation: "Low",
      start_time: Date.now(),
      duration: 5,
      hard_limit: false,
      requires_authorization: false,
      sprint_id,
    });

    const newSprint = new Sprint({
      sprint_id,
      title: `${first_name}'s First Sprint`,
      owner: newUser,
      members: [newUser],
      viewers: [],
      status: {
        time_allocated: 0,
        time_over: 0,
        active_status: "Not Started",
      },
      start_date_time: Date.now(),
      duration: "1209600000",
      kpi_data: {},
    });

    const newAlert = new Alert({
      alert_id,
      to_user: newUser,
      created_by: {
        name: "Kamari",
      },
      text: "Welcome to Kamari. We are so excited you trust us as a sprint management tool! Check out your first task to get oriented around the platform.",
      task: firstTask,
      timestamp: Date.now(),
      escalation: "Low",
    });

    // save new user and the new group made for the user
    const created_user = await newUser.save();

    const created_task = await firstTask.save();
    const created_org = await newOrg.save();
    await newSprint.save();

    await User.findOneAndUpdate(
      { user_id },
      {
        $push: { tasks: created_task },
      }
    ).then(async (res) => {
      await newAlert.save();
    });

    await Organization.findOneAndUpdate(
      { org_id },
      {
        $push: {
          members: created_user,
          admins: created_user,
        },
      }
    );

    // generate email content
    const mail_options = {
      from: "jammanager.io@gmail.com",
      to: email, // The user's email address
      subject: "Welcome to Kamari",
      html: `
      <html>
      <head>
        <style>
          /* Add inline styles here for your email */
          body {
            font-family: Arial, sans-serif;
            background-color: #f5f5f5;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
            border-radius: 10px;
            box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            background-color: #007BFF;
            color: #ffffff;
            padding: 20px 0;
            border-radius: 10px 10px 0 0;
          }
          .header h1 {
            font-size: 24px;
            margin: 0;
          }
          .content {
            padding: 20px;
          }
          .content img {
            max-width: 100%;
            height: auto;
            display: block;
            margin: 0 auto;
          }
          .button {
            text-align: center;
            margin-top: 20px;
          }
          .button a {
            display: inline-block;
            background-color: #007BFF;
            color: #ffffff;
            text-decoration: none;
            padding: 10px 20px;
            border-radius: 5px;
          }
          .unsubscribe {
            text-align: center;
            margin-top: 20px;
          }
          .unsubscribe a {
            color: #007BFF;
            text-decoration: none;
          }
          .footer {
            text-align: center;
            margin-top: 20px;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to Kamari</h1>
          </div>
          <div class="content">
            <img src="https://jammanager.s3.us-east-2.amazonaws.com/kamari.png" alt="Jam Manager Logo">
            <div class="button">
              <a href="https://jam-manager.netlify.app/" style="background-color: #007BFF; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Visit Jam Manager</a>
            </div>
          </div>
          <div class="unsubscribe">
            <a href="https://jam-manager.netlify.app/unsubscribe/${email}">Unsubscribe</a>
          </div>
          <div class="footer">
            <a href="https://jam-manager.netlify.app/terms-and-conditions">Terms</a>
          </div>
        </div>
      </body>
      </html>
      `,
    };

    // call transporter to send email
    transporter.sendMail(mail_options, (error, info) => {
      if (error) {
        console.error("Email sending error:", error);
      } else {
        console.log("Email sent:", info);
      }
    });

    // sign the first token provided to the user
    const token = jwt.sign({ userId: user_id }, SECRET_JWT, {
      expiresIn: "30d",
    });

    res.status(200).json({
      message: "User Registered",
      user: created_user,
      organization: created_org,
      token,
    });
  } catch (error) {
    console.error("Error during user registration:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
});

app.post("/login", async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    console.log(req.body);

    const { email, password } = req.body;
    console.log(email, password);

    const existing_user = await User.find({ email })[0];

    console.log(existing_user);

    if (Object.keys(existing_user).length === 0) {
      res.status(500).json({ message: "User not found" });
      console.log("user not found");
    } else {
      console.log("user found");

      console.log("starting hash compare");

      const hash_compare = await comparePassword(
        password,
        existing_user.password
      );

      console.log("hash compare complete");

      if (hash_compare) {
        console.log("hash compare true");

        const signed_user = jwt.sign({ user: existing_user, userId: existing_user.user_id }, process.env.SECRET_JWT, {
          expiresIn: "7d"
        });

        console.log("#### signed user ####", signed_user)

        const result = {
          user: existing_user,
          token: signed_user
        };

        console.log(result)

        res.status(200).json(result);

        console.log
      } else {
        console.log("hash compare false");
        res
          .status(400)
          .json({ message: "User not authorized. Incorrect password" });
      }
    }
  } catch (error) {
    res.status(500).json({ message: error });
  }
});

app.get("/alerts", authenticateJWT, async (req, res) => {
  try {
    await dbConnect(process.env.GEN_AUTH);

    const user_id = req.user.userId;

    // Pagination parameters
    const pageSize = parseInt(req.query.pageSize) || 10; // Default page size
    const page = parseInt(req.query.page) || 1; // Default to first page

    // Calculate the number of documents to skip
    const skip = (page - 1) * pageSize;

    // Query with limit and skip for pagination
    const user_alerts = await Alert.find({ "to_user.user_id": user_id })
      .limit(pageSize)
      .skip(skip);

    res.status(200).json({ alerts: user_alerts });
  } catch (error) {
    console.error("Error fetching alerts:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/tasks", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const user_id = req.user.userId;

    let user = await User.find({ user_id });
    const tasks = await Task.find({ assignees: { $in: [user[0].email] } });

    res.status(200).json({
      status: 200,
      tasks,
    });
  } catch (error) {
    res.status(500).json({ status: 500, message: error });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
