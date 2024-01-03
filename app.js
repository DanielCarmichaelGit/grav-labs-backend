const express = require("express");
const cors = require("cors");

// import utility functions
const dbConnect = require("./src/utils/dbConnect");
const generateUniqueUsername = require("./src/utils/generateUsername");
const arrayDifference = require("./src/utils/findDiff");

// import packages
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const sgTransport = require("nodemailer-sendgrid-transport");

// Secret key for JWT signing (change it to a strong, random value)
const SECRET_JWT = process.env.SECRET_JWT;

// import models
const User = require("./src/models/user");
const Organization = require("./src/models/organization");

const app = express();
app.use(cors());
app.options("*", cors()); // Enable CORS pre-flight request for all routes
app.use(express.json());

// Middleware to verify JWT token
function authenticateJWT(req, res, next) {
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

// create utility transporter for email service
const transporter = nodemailer.createTransport(
  sgTransport({
    auth: {
      api_key: process.env.SG_API_KEY, // Replace with your SendGrid API key
    },
  })
);

// test endpoint to verify server status
app.get("/", (req, res) => {
  console.log("received home");
  return res.status(200).json({ message: "working" });
});

//###########################################################################
// Add a POST endpoint for user registration (signup)
app.post("/signup", async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);
    const { password, email, organization, type } = req.body; // Add jam_group

    // Check if the username already exists
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(409).json({ message: "Username already exists", redirect: { url: "google.com"} });
    }

    const user_id = uuidv4();

    // Hash the password before saving it
    const hashedPassword = await bcrypt.hash(password, 10);



    //Create a jam group for this new user
    const newUser = new User({
      user_id,
      password: hashedPassword,
      email,
      organization: {},
      kpi_data: {},
      tasks: [{
        title: "Orientation",
        assigned_by: {
          name: Kamari,
          email: "danielfcarmichael@gmail.com",
          assignees: [],
          client: {},
          status: {
            status_title: "Not Started",
            status_code: "000",
            status_percentage: 0
          }
        },
      }],
      type,
      _id: new_user_id,
    });

    // save new user and the new group made for the user
    newUser.save().then((res) => {
      console.log(res)
    });

    // generate email content
    const mail_options = {
      from: "jammanager.io@gmail.com",
      to: email, // The user's email address
      subject: "Welcome to Jam Manager",
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
            <h1>Welcome to Jam Manager</h1>
          </div>
          <div class="content">
            <img src="https://jammanager.s3.us-east-2.amazonaws.com/DALL%C2%B7E+2023-12-15+01.44.30+-+Create+a+logo+for+'Jam+Manager'+without+any+text%2C+focusing+purely+on+visual+elements.+The+logo+should+feature+a+stylized%2C+colorful+jar+of+jam%2C+represe.png" alt="Jam Manager Logo">
            <div class="button">
              <a href="https://jam-manager.netlify.app/" style="background-color: #007BFF; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Visit Jam Manager</a>
            </div>
          </div>
          <div class="unsubscribe">
            <a href="#">Unsubscribe</a>
          </div>
          <div class="footer">
            <a href="#">Terms</a>
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
    const token = jwt.sign(
      { userId: new_user_id, jamGroup: new_jam_id },
      SECRET_JWT,
      {
        expiresIn: "30d",
      }
    );

    res.status(200).json({
      message: "User Registered",
      user: newUser,
      user_group: newGroup,
      token,
    });
  } catch (error) {
    console.error("Error during user registration:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
});
