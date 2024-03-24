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
const Project = require("./src/models/project");
const Document = require("./src/models/document");
const Folder = require("./src/models/folder");
const ClientInvitation = require("./src/models/clientInvitation");
const ClientUser = require("./src/models/clientUser");
const Client = require("./src/models/client");
const TeamInvitation = require("./src/models/teamInvitation");

const app = express();
app.use(cors());
app.options("*", cors()); // Enable CORS pre-flight request for all routes
app.use(express.json({ limit: "50mb" }));

// create utility transporter for email service
const transporter = nodemailer.createTransport(
  sgTransport({
    auth: {
      api_key: process.env.SG_API_KEY,
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
    const {
      password,
      email,
      organization,
      type,
      role,
      existing_org_id,
      name,
      invitation_id,
      hourly_rate,
    } = req.body;
    console.log(name);

    const { first, last } = name;

    console.log("full name", first, last);

    // Check if the username already exists
    const existingUser = await User.findOne({ email });

    // if existing user, early return
    if (existingUser) {
      return res.status(409).json({
        message: "Username already exists",
        redirect: { url: "https://kamariteams.com" },
      });
    }

    if (existing_org_id) {
      console.log("Signing up a user for existing org");
      try {
        console.log("1");
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const user_id = uuidv4();
        const org_id = existing_org_id;

        console.log("2", org_id);

        const organization = await Organization.findOne({ org_id });

        console.log("3", organization);

        const newUser = new User({
          user_id,
          email,
          password: hashedPassword,
          name: {
            first,
            last,
          },
          organization,
          kpi_data: {},
          tasks: [],
          type: "Standard",
          sprints: [],
          marketable: true,
          hourly_rate: parseInt(hourly_rate),
        });

        console.log("4", newUser);

        const created_user = await newUser.save();

        console.log("5", created_user);

        const org_user = {
          user_id,
          email,
          name: {
            first,
            last,
          },
          role,
          hourly_rate: parseInt(hourly_rate),
        };

        console.log("6", org_user);

        if (role.toLowerCase() === "Admin") {
          console.log("7", "admin");
          organization.admins.push(org_user);
        } else {
          console.log("8", "standard");
          organization.members.push(org_user);
        }

        console.log("9", organization.seats);

        organization.seats = organization.seats + 1;

        console.log("10", organization.seats);

        const updated_org = await Organization.findOneAndUpdate(
          { org_id },
          {
            $set: { ...organization },
          }
        );

        console.log("11", updated_org);

        // sign the first token provided to the user
        const token = jwt.sign(
          { user: created_user, userId: user_id },
          process.env.SECRET_JWT,
          {
            expiresIn: "7d",
          }
        );

        console.log("12", token);

        await TeamInvitation.findOneAndUpdate(
          { invitation_id },
          {
            status: "accepted",
          }
        );

        console.log("13");

        res.status(200).json({
          message: "User Registered",
          user: created_user,
          organization: updated_org,
          token,
        });
      } catch (error) {
        res.status(500).json({ message: error });
      }
    } else {
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      const user_id = uuidv4();
      const org_id = uuidv4();
      const sprint_id = uuidv4();
      const project_id = uuidv4();

      //Create a jam group for this new user
      const newUser = new User({
        user_id,
        email,
        password: hashedPassword,
        name: {
          first,
          last,
        },
        organization: {},
        kpi_data: {},
        tasks: [],
        type: "Standard",
        sprints: [sprint_id],
        marketable: true,
        hourly_rate: parseInt(hourly_rate),
      });

      const org_user = {
        user_id,
        email,
        name: {
          first: first,
          last: last,
        },
        type,
        hourly_rate: parseInt(hourly_rate),
      };

      // create new org
      const newOrg = new Organization({
        org_id,
        name: organization,
        admins: [org_user],
        members: [org_user],
        seats: 2,
        status: "active",
        billable_user: {
          email: newUser.email,
          user_id: newUser.user_id,
        },
        billing: {},
        sprints: [sprint_id],
        client_invitations: [],
      });

      const created_org = await newOrg.save();

      // save new user and the new group made for the user
      newUser.organization = created_org;
      const created_user = await newUser.save();

      // generate email content
      const mail_options = {
        from: "contact@kamariteams.com",
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
            <img src="https://jammanager.s3.us-east-2.amazonaws.com/kamari.png" alt="Kamari Logo">
            <div class="button">
              <a href="kamariteams.com" style="background-color: #007BFF; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Visit Jam Manager</a>
            </div>
          </div>
          <div class="unsubscribe">
            <a href="https://kamariteams.com/unsubscribe/${email}">Unsubscribe</a>
          </div>
          <div class="footer">
            <a href="https://kamariteams.com/terms-and-conditions">Terms</a>
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
        { user: created_user, userId: user_id },
        process.env.SECRET_JWT,
        {
          expiresIn: "7d",
        }
      );

      res.status(200).json({
        message: "User Registered",
        user: created_user,
        organization: created_org,
        token,
      });
    }
  } catch (error) {
    console.error("Error during user registration:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
});

app.get("/checkout-session", authenticateJWT, async (req, res) => {
  try {
    //pk_live_51OsVMcFccUTJ6xdayLO7zRpeMUUhdDHKhEkajUALbrsYGvq4vPNiCIYOyrZmB980qOp5as5K6SQ3iDnrvEtqCqt300mwDtRO0i

    const user = req.user.user;
    const { checkout_session_id } = req.query;

    if (checkout_session_id) {
      const stripe = require("stripe")(process.env.STRIPE_TEST);
      const session = await stripe.checkout.sessions.retrieve(
        checkout_session_id
      );

      if (session) {
        if (session.client_reference_id === user.organization.org_id) {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription
          );
          await Organization.findOneAndUpdate(
            { org_id: user.organization.org_id },
            {
              billable_user: session.customer_details,
              billing: subscription,
            }
          );
          res.status(200).json({
            message: "Session found and org updated to reflect billing",
            checkout_session: session,
            subscription,
          });
        } else {
          res.status(409).json({
            message: "Unauthorized access",
          });
        }
      } else {
        res.status(404).json({
          message: "No session found for given checkout session id",
        });
      }
    } else {
      res.status(404).json({
        message: "Please provide a checkout session",
      });
    }
  } catch (error) {
    console.error("Error during user registration:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
});

app.post("/login", async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { email, password } = req.body;

    const existing_user = await User.find({ email });

    if (Object.keys(existing_user[0]).length === 0) {
      res.status(500).json({ message: "User not found" });
      console.log("user not found");
    } else {
      const hash_compare = await comparePassword(
        password,
        existing_user[0].password
      );

      if (hash_compare) {
        console.log("hash compare true");

        const signed_user = jwt.sign(
          { user: existing_user[0], userId: existing_user[0].user_id },
          process.env.SECRET_JWT,
          {
            expiresIn: "7d",
          }
        );

        const result = {
          user: existing_user[0],
          token: signed_user,
        };

        res.status(200).json(result);
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

    // Query with limit and skip for pagination
    const user_alerts = await Alert.find({ "to_user.user_id": user_id });

    res.status(200).json({ alerts: user_alerts });
  } catch (error) {
    console.error("Error fetching alerts:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/documents", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { document_name, client, folder, content, title } = req.body;
    const user_id = req.user.userId;
    const user = await User.find({ user_id });
    const document_id = uuidv4();

    const newDocument = new Document({
      document_id,
      associated_org: user.organization,
      contributors: [user],
      client,
      updates: [],
      folder,
      document_name,
      creator: user,
      content,
      create_timestamp: Date.now(),
      title,
    });

    const created_document = await newDocument.save();

    res.status(200).json({
      message: success,
      created_resource: created_document,
    });
  } catch (error) {
    res.status(500).json({
      message: error,
    });
  }
});

app.post("/sprints", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const user = req.user.user;

    const {
      title,
      members,
      viewers,
      start_date_time,
      duration,
      kpi_data,
      tasks,
      objective,
      description,
    } = req.body;

    const active_sprint = await Sprint.findOne({ status: "Active" });
    const sprint_id = uuidv4();

    const newSprint = new Sprint({
      sprint_id,
      title,
      owner: user,
      members,
      viewers,
      status: "Active",
      start_date_time,
      duration,
      kpi_data,
      organization: user.organization,
      objective,
      is_started: false,
      tasks,
      description,
    });

    if (active_sprint) {
      newSprint.status = "Not Started";
    }

    const saved_sprint = await newSprint.save();

    res.status(200).json({
      message: "Sprint Created",
      sprint: saved_sprint,
    });
  } catch (error) {
    res.status(500).json({
      message: error,
      attempted_resource: req.body,
    });
  }
});

app.get("/sprints", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const user = req.user.user;

    const sprints = await Sprint.find({
      "organization.org_id": user.organization.org_id,
    });

    res.status(200).json({
      message: "Sprints Retrieved",
      count: sprints.length,
      sprints,
    });
  } catch (error) {
    res.status(500).json({
      message: error,
    });
  }
});

app.get("/team", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const user = req.user.user;
    const { org_id } = req.query;

    if (org_id) {
      const team = await User.find({ "organization.org_id": org_id });

      res.status(200).json({
        message: "Team Found",
        count: team.length,
        team,
      });
    } else {
      const team = await User.find({
        "organization.org_id": user.organization.org_id,
      });

      res.status(200).json({
        message: "Team Found",
        count: team.length,
        team,
      });
    }
  } catch (error) {
    res.status(500).json({
      message: error,
    });
  }
});

app.post("/permission", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { user_id, new_type } = req.body;
    const organization = await Organization.findOne({
      org_id: req.user.user.organization.org_id,
    });

    const target_user = await User.findOne({ user_id });

    console.log("1", target_user);

    if (!organization) {
      return res.status(404).json({ message: "Organization not found" });
    }

    console.log("2", organization);

    // Check if user is an admin
    const isAdmin = organization.admins.some(
      (admin) => admin.user_id === user_id
    );

    console.log("3", isAdmin);

    if (new_type === "Admin" && !isAdmin) {
      console.log("4");
      // Add to admins if not already an admin
      organization.admins.push(target_user);
      console.log("5");
    } else if (new_type === "Standard" && isAdmin) {
      console.log("6", isAdmin);
      // Remove from admins if currently an admin
      organization.admins = organization.admins.filter(
        (admin) => admin.user_id !== user_id
      );
    }

    console.log("7", organization);

    const new_organization = await Organization.findOneAndUpdate(
      { org_id: organization.org_id },
      {
        $set: { ...organization },
      }
    );

    console.log("8");

    res.json({
      message: "User role updated successfully.",
      organization: new_organization,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

app.post("/create-customer-portal", authenticateJWT, async (req, res) => {
  try {
    const user = req.user.user;
    console.log("1");
    if (user) {
      console.log("USER FOUND AND AUTH IS VALID");
      dbConnect(process.env.GEN_AUTH);
      const organization = await Organization.findOne({
        org_id: user.organization.org_id,
      });
      console.log("2");
      if (organization && organization.billing) {
        console.log("3");
        if (organization.billing.customer) {
          console.log("4");
          const stripe = require("stripe")(process.env.STRIPE_TEST);
          const session = await stripe.billingPortal.sessions.create({
            customer: organization.billing.customer,
            return_url: "https://kamariteams.com",
          });
          console.log("5");
          if (session) {
            console.log("6");
            res.status(200).json({
              message: "Customer portal connection established",
              connect_url: session,
            });
          } else {
            console.log("7");
            res.status(400).json({
              message: "There was an error creating the customer session",
            });
          }
        } else {
          console.log("8");
          res.status(404).json({
            message:
              "The associated organization does not have a customer account",
          });
        }
      } else {
        console.log("9");
        res.status(500).json({
          message: "Organization not found or is not an active customer",
        });
      }
    } else {
      console.log("10");
      res.status(409).json({
        message: "Unauthorized access",
      });
    }
  } catch (error) {
    res.status(500).json({
      message: error,
      requested_resource: "Could not create session",
    });
  }
});

app.post("/create-login-link", authenticateJWT, async (req, res) => {
  try {
    const user = req.user.user;

    if (user) {
      const organization = await Organization.findOne({
        org_id: user.organization.org_id,
      });

      if (organization && organization.stripe_account) {
        const stripe = require("stripe")(process.env.STRIPE_TEST);
        const loginLink = await stripe.accounts.createLoginLink(
          organization.stripe_account.id
        );

        if (loginLink) {
          res.status(200).json({
            message: "Login link created",
            connect_url: loginLink,
          });
        } else {
          res.status(400).json({
            message:
              "Something went wrong creating the login link, try again later.",
          });
        }
      } else {
        res.status(404).json({
          message: "Could not find associated organization's stripe account",
        });
      }
    } else {
      res.status(409).json({
        message: "Invalid authentication",
      });
    }
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

app.post("/reset-password-link", async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { email } = req.body;

    const user = await User.findOne({ email }).select("user_id -_id");

    if (user?.user_id) {
      const mail_options = {
        from: `"Kamari" <contact@kamariteams.com>`,
        to: email, // The user's email address
        subject: "Kamari: Password Reset",
        text: `Password reset link. \n\nIf you did not request to reset your password, please email our ceo @danielfcarmichael@gmail.com to get an immediate response. \n\nAs we grow, we are adding measures to insure product security. But, things do slip through. If you feel like you have lost trust please give our ceo a call @2314635567 to discuss your concerns.`,
        html: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
        <html data-editor-version="2" class="sg-campaigns" xmlns="http://www.w3.org/1999/xhtml">
            <head>
              <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1">
              <!--[if !mso]><!-->
              <meta http-equiv="X-UA-Compatible" content="IE=Edge">
              <!--<![endif]-->
              <!--[if (gte mso 9)|(IE)]>
              <xml>
                <o:OfficeDocumentSettings>
                  <o:AllowPNG/>
                  <o:PixelsPerInch>96</o:PixelsPerInch>
                </o:OfficeDocumentSettings>
              </xml>
              <![endif]-->
              <!--[if (gte mso 9)|(IE)]>
          <style type="text/css">
            body {width: 600px;margin: 0 auto;}
            table {border-collapse: collapse;}
            table, td {mso-table-lspace: 0pt;mso-table-rspace: 0pt;}
            img {-ms-interpolation-mode: bicubic;}
          </style>
        <![endif]-->
              <style type="text/css">
            body, p, div {
              font-family: arial,helvetica,sans-serif;
              font-size: 14px;
            }
            body {
              color: #000000;
            }
            body a {
              color: #1188E6;
              text-decoration: none;
            }
            p { margin: 0; padding: 0; }
            table.wrapper {
              width:100% !important;
              table-layout: fixed;
              -webkit-font-smoothing: antialiased;
              -webkit-text-size-adjust: 100%;
              -moz-text-size-adjust: 100%;
              -ms-text-size-adjust: 100%;
            }
            img.max-width {
              max-width: 100% !important;
            }
            .column.of-2 {
              width: 50%;
            }
            .column.of-3 {
              width: 33.333%;
            }
            .column.of-4 {
              width: 25%;
            }
            ul ul ul ul  {
              list-style-type: disc !important;
            }
            ol ol {
              list-style-type: lower-roman !important;
            }
            ol ol ol {
              list-style-type: lower-latin !important;
            }
            ol ol ol ol {
              list-style-type: decimal !important;
            }
            @media screen and (max-width:480px) {
              .preheader .rightColumnContent,
              .footer .rightColumnContent {
                text-align: left !important;
              }
              .preheader .rightColumnContent div,
              .preheader .rightColumnContent span,
              .footer .rightColumnContent div,
              .footer .rightColumnContent span {
                text-align: left !important;
              }
              .preheader .rightColumnContent,
              .preheader .leftColumnContent {
                font-size: 80% !important;
                padding: 5px 0;
              }
              table.wrapper-mobile {
                width: 100% !important;
                table-layout: fixed;
              }
              img.max-width {
                height: auto !important;
                max-width: 100% !important;
              }
              a.bulletproof-button {
                display: block !important;
                width: auto !important;
                font-size: 80%;
                padding-left: 0 !important;
                padding-right: 0 !important;
              }
              .columns {
                width: 100% !important;
              }
              .column {
                display: block !important;
                width: 100% !important;
                padding-left: 0 !important;
                padding-right: 0 !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
              }
              .social-icon-column {
                display: inline-block !important;
              }
            }
          </style>
              <!--user entered Head Start--><!--End Head user entered-->
            </head>
            <body>
              <center class="wrapper" data-link-color="#1188E6" data-body-style="font-size:14px; font-family:arial,helvetica,sans-serif; color:#000000; background-color:#FFFFFF;">
                <div class="webkit">
                  <table cellpadding="0" cellspacing="0" border="0" width="100%" class="wrapper" bgcolor="#FFFFFF">
                    <tr>
                      <td valign="top" bgcolor="#FFFFFF" width="100%">
                        <table width="100%" role="content-container" class="outer" align="center" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td width="100%">
                              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                  <td>
                                    <!--[if mso]>
            <center>
            <table><tr><td width="600">
          <![endif]-->
                                            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px;" align="center">
                                              <tr>
                                                <td role="modules-container" style="padding:0px 0px 0px 0px; color:#000000; text-align:left;" bgcolor="#FFFFFF" width="100%" align="left"><table class="module preheader preheader-hide" role="module" data-type="preheader" border="0" cellpadding="0" cellspacing="0" width="100%" style="display: none !important; mso-hide: all; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0;">
            <tr>
              <td role="module-content">
                <p></p>
              </td>
            </tr>
          </table><table border="0" cellpadding="0" cellspacing="0" align="center" width="100%" role="module" data-type="columns" style="padding:0px 0px 0px 0px;" bgcolor="#FFFFFF" data-distribution="1,1">
            <tbody>
              <tr role="module-content">
                <td height="100%" valign="top"><table width="290" style="width:290px; border-spacing:0; border-collapse:collapse; margin:0px 10px 0px 0px;" cellpadding="0" cellspacing="0" align="left" border="0" bgcolor="" class="column column-0">
              <tbody>
                <tr>
                  <td style="padding:0px;margin:0px;border-spacing:0;"><table class="wrapper" role="module" data-type="image" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="dBRBKqWsYgsricgDWAGd23">
            <tbody>
              <tr>
                <td style="font-size:6px; line-height:10px; padding:0px 0px 0px 0px;" valign="top" align="center">
                  <img class="max-width" border="0" style="display:block; color:#000000; text-decoration:none; font-family:Helvetica, arial, sans-serif; font-size:16px; max-width:100% !important; width:100%; height:auto !important;" width="290" alt="" data-proportionally-constrained="true" data-responsive="true" src="http://cdn.mcauto-images-production.sendgrid.net/92bbbf50563199d0/680603af-7415-4fdd-9736-6be7e0a29757/1000x500.png">
                </td>
              </tr>
            </tbody>
          </table></td>
                </tr>
              </tbody>
            </table><table width="290" style="width:290px; border-spacing:0; border-collapse:collapse; margin:0px 0px 0px 10px;" cellpadding="0" cellspacing="0" align="left" border="0" bgcolor="" class="column column-1">
              <tbody>
                <tr>
                  <td style="padding:0px;margin:0px;border-spacing:0;"><table class="module" role="module" data-type="spacer" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="df8d00a9-5a76-4676-82f5-bea1fc2597ae">
            <tbody>
              <tr>
                <td style="padding:0px 0px 30px 0px;" role="module-content" bgcolor="">
                </td>
              </tr>
            </tbody>
          </table><table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="e91ZwuHxUeknHu24krPgcX" data-mc-module-version="2019-10-22">
            <tbody>
              <tr>
                <td style="padding:18px 0px 18px 0px; line-height:22px; text-align:inherit;" height="100%" valign="top" bgcolor="" role="module-content"><div><div style="font-family: inherit; text-align: inherit">You requested a password reset link</div><div></div></div></td>
              </tr>
            </tbody>
          </table></td>
                </tr>
              </tbody>
            </table></td>
              </tr>
            </tbody>
          </table><table border="0" cellpadding="0" cellspacing="0" class="module" data-role="module-button" data-type="button" role="module" style="table-layout:fixed;" width="100%" data-muid="235b3326-6bfd-4935-b039-dbf42dae480e">
              <tbody>
                <tr>
                  <td align="right" bgcolor="" class="outer-td" style="padding:0px 0px 0px 0px;">
                    <table border="0" cellpadding="0" cellspacing="0" class="wrapper-mobile" style="text-align:center;">
                      <tbody>
                        <tr>
                        <td align="center" bgcolor="#be4bff" class="inner-td" style="border-radius:6px; font-size:16px; text-align:right; background-color:inherit;">
                          <a href="https://kamariteams.com/forgot-password?u=${user.user_id}" style="background-color:#be4bff; border:0px solid #333333; border-color:#333333; border-radius:6px; border-width:0px; color:#ffffff; display:inline-block; font-size:14px; font-weight:normal; letter-spacing:0px; line-height:normal; padding:12px 18px 12px 18px; text-align:center; text-decoration:none; border-style:solid; width:600px;" target="_blank">Reset Password</a>
                        </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody>
            </table><table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="f424383d-0101-4b99-b99a-8d428a219037" data-mc-module-version="2019-10-22">
            <tbody>
              <tr>
        <div style="font-family: inherit; text-align: inherit"><br></div>
        <div style="font-family: inherit; text-align: inherit">The above link will remain active for 30 minutes.</div>
        <div style="font-family: inherit; text-align: inherit"><br></div>
        <div style="font-family: inherit; text-align: inherit">To ensure security, we limit the number of password resets to 1 per month. If you have forgotten your password and need access, ask your org admin to contact us @2314635567. If you are the admin, please contact us at the provided phone number.</div><div></div></div></td>
              </tr>
            </tbody>
          </table><div data-role="module-unsubscribe" class="module" role="module" data-type="unsubscribe" style="color:#444444; font-size:12px; line-height:20px; padding:16px 16px 16px 16px; text-align:Center;" data-muid="4e838cf3-9892-4a6d-94d6-170e474d21e5"><div class="Unsubscribe--addressLine"></div><p style="font-size:12px; line-height:20px;"><a class="Unsubscribe--unsubscribeLink" href="{{{unsubscribe}}}" target="_blank" style="">Unsubscribe</a> - <a href="{{{unsubscribe_preferences}}}" target="_blank" class="Unsubscribe--unsubscribePreferences" style="">Unsubscribe Preferences</a></p></div></td>
                                              </tr>
                                            </table>
                                            <!--[if mso]>
                                          </td>
                                        </tr>
                                      </table>
                                    </center>
                                    <![endif]-->
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </div>
              </center>
            </body>
          </html>`,
      };

      console.log("calling transporter");
      // call transporter to send email
      transporter.sendMail(mail_options, (error, info) => {
        if (error) {
          console.error("Email sending error:", error);
        } else {
          console.log("Email sent:", info);
        }
      });

      res.status(200).json({
        message: "Password Reset Link Sent",
      });
    } else {
      const client_user = await ClientUser.findOne({
        client_user_email: email,
      }).select("client_user_id -_id");

      if (client_user?.client_user_id) {
        const mail_options = {
          from: `"Kamari" <contact@kamariteams.com>`,
          to: email, // The user's email address
          subject: "Kamari: Password Reset",
          text: `Password reset link. \n\nIf you did not request to reset your password, please email our ceo @danielfcarmichael@gmail.com to get an immediate response. \n\nAs we grow, we are adding measures to insure product security. But, things do slip through. If you feel like you have lost trust please give our ceo a call @2314635567 to discuss your concerns.`,
          html: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
          <html data-editor-version="2" class="sg-campaigns" xmlns="http://www.w3.org/1999/xhtml">
              <head>
                <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1">
                <!--[if !mso]><!-->
                <meta http-equiv="X-UA-Compatible" content="IE=Edge">
                <!--<![endif]-->
                <!--[if (gte mso 9)|(IE)]>
                <xml>
                  <o:OfficeDocumentSettings>
                    <o:AllowPNG/>
                    <o:PixelsPerInch>96</o:PixelsPerInch>
                  </o:OfficeDocumentSettings>
                </xml>
                <![endif]-->
                <!--[if (gte mso 9)|(IE)]>
            <style type="text/css">
              body {width: 600px;margin: 0 auto;}
              table {border-collapse: collapse;}
              table, td {mso-table-lspace: 0pt;mso-table-rspace: 0pt;}
              img {-ms-interpolation-mode: bicubic;}
            </style>
          <![endif]-->
                <style type="text/css">
              body, p, div {
                font-family: arial,helvetica,sans-serif;
                font-size: 14px;
              }
              body {
                color: #000000;
              }
              body a {
                color: #1188E6;
                text-decoration: none;
              }
              p { margin: 0; padding: 0; }
              table.wrapper {
                width:100% !important;
                table-layout: fixed;
                -webkit-font-smoothing: antialiased;
                -webkit-text-size-adjust: 100%;
                -moz-text-size-adjust: 100%;
                -ms-text-size-adjust: 100%;
              }
              img.max-width {
                max-width: 100% !important;
              }
              .column.of-2 {
                width: 50%;
              }
              .column.of-3 {
                width: 33.333%;
              }
              .column.of-4 {
                width: 25%;
              }
              ul ul ul ul  {
                list-style-type: disc !important;
              }
              ol ol {
                list-style-type: lower-roman !important;
              }
              ol ol ol {
                list-style-type: lower-latin !important;
              }
              ol ol ol ol {
                list-style-type: decimal !important;
              }
              @media screen and (max-width:480px) {
                .preheader .rightColumnContent,
                .footer .rightColumnContent {
                  text-align: left !important;
                }
                .preheader .rightColumnContent div,
                .preheader .rightColumnContent span,
                .footer .rightColumnContent div,
                .footer .rightColumnContent span {
                  text-align: left !important;
                }
                .preheader .rightColumnContent,
                .preheader .leftColumnContent {
                  font-size: 80% !important;
                  padding: 5px 0;
                }
                table.wrapper-mobile {
                  width: 100% !important;
                  table-layout: fixed;
                }
                img.max-width {
                  height: auto !important;
                  max-width: 100% !important;
                }
                a.bulletproof-button {
                  display: block !important;
                  width: auto !important;
                  font-size: 80%;
                  padding-left: 0 !important;
                  padding-right: 0 !important;
                }
                .columns {
                  width: 100% !important;
                }
                .column {
                  display: block !important;
                  width: 100% !important;
                  padding-left: 0 !important;
                  padding-right: 0 !important;
                  margin-left: 0 !important;
                  margin-right: 0 !important;
                }
                .social-icon-column {
                  display: inline-block !important;
                }
              }
            </style>
                <!--user entered Head Start--><!--End Head user entered-->
              </head>
              <body>
                <center class="wrapper" data-link-color="#1188E6" data-body-style="font-size:14px; font-family:arial,helvetica,sans-serif; color:#000000; background-color:#FFFFFF;">
                  <div class="webkit">
                    <table cellpadding="0" cellspacing="0" border="0" width="100%" class="wrapper" bgcolor="#FFFFFF">
                      <tr>
                        <td valign="top" bgcolor="#FFFFFF" width="100%">
                          <table width="100%" role="content-container" class="outer" align="center" cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td width="100%">
                                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                                  <tr>
                                    <td>
                                      <!--[if mso]>
              <center>
              <table><tr><td width="600">
            <![endif]-->
                                              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px;" align="center">
                                                <tr>
                                                  <td role="modules-container" style="padding:0px 0px 0px 0px; color:#000000; text-align:left;" bgcolor="#FFFFFF" width="100%" align="left"><table class="module preheader preheader-hide" role="module" data-type="preheader" border="0" cellpadding="0" cellspacing="0" width="100%" style="display: none !important; mso-hide: all; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0;">
              <tr>
                <td role="module-content">
                  <p></p>
                </td>
              </tr>
            </table><table border="0" cellpadding="0" cellspacing="0" align="center" width="100%" role="module" data-type="columns" style="padding:0px 0px 0px 0px;" bgcolor="#FFFFFF" data-distribution="1,1">
              <tbody>
                <tr role="module-content">
                  <td height="100%" valign="top"><table width="290" style="width:290px; border-spacing:0; border-collapse:collapse; margin:0px 10px 0px 0px;" cellpadding="0" cellspacing="0" align="left" border="0" bgcolor="" class="column column-0">
                <tbody>
                  <tr>
                    <td style="padding:0px;margin:0px;border-spacing:0;"><table class="wrapper" role="module" data-type="image" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="dBRBKqWsYgsricgDWAGd23">
              <tbody>
                <tr>
                  <td style="font-size:6px; line-height:10px; padding:0px 0px 0px 0px;" valign="top" align="center">
                    <img class="max-width" border="0" style="display:block; color:#000000; text-decoration:none; font-family:Helvetica, arial, sans-serif; font-size:16px; max-width:100% !important; width:100%; height:auto !important;" width="290" alt="" data-proportionally-constrained="true" data-responsive="true" src="http://cdn.mcauto-images-production.sendgrid.net/92bbbf50563199d0/680603af-7415-4fdd-9736-6be7e0a29757/1000x500.png">
                  </td>
                </tr>
              </tbody>
            </table></td>
                  </tr>
                </tbody>
              </table><table width="290" style="width:290px; border-spacing:0; border-collapse:collapse; margin:0px 0px 0px 10px;" cellpadding="0" cellspacing="0" align="left" border="0" bgcolor="" class="column column-1">
                <tbody>
                  <tr>
                    <td style="padding:0px;margin:0px;border-spacing:0;"><table class="module" role="module" data-type="spacer" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="df8d00a9-5a76-4676-82f5-bea1fc2597ae">
              <tbody>
                <tr>
                  <td style="padding:0px 0px 30px 0px;" role="module-content" bgcolor="">
                  </td>
                </tr>
              </tbody>
            </table><table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="e91ZwuHxUeknHu24krPgcX" data-mc-module-version="2019-10-22">
              <tbody>
                <tr>
                  <td style="padding:18px 0px 18px 0px; line-height:22px; text-align:inherit;" height="100%" valign="top" bgcolor="" role="module-content"><div><div style="font-family: inherit; text-align: inherit">You requested a password reset link</div><div></div></div></td>
                </tr>
              </tbody>
            </table></td>
                  </tr>
                </tbody>
              </table></td>
                </tr>
              </tbody>
            </table><table border="0" cellpadding="0" cellspacing="0" class="module" data-role="module-button" data-type="button" role="module" style="table-layout:fixed;" width="100%" data-muid="235b3326-6bfd-4935-b039-dbf42dae480e">
                <tbody>
                  <tr>
                    <td align="right" bgcolor="" class="outer-td" style="padding:0px 0px 0px 0px;">
                      <table border="0" cellpadding="0" cellspacing="0" class="wrapper-mobile" style="text-align:center;">
                        <tbody>
                          <tr>
                          <td align="center" bgcolor="#be4bff" class="inner-td" style="border-radius:6px; font-size:16px; text-align:right; background-color:inherit;">
                            <a href="https://kamariteams.com/forgot-password?u=${client_user.client_user_id}" style="background-color:#be4bff; border:0px solid #333333; border-color:#333333; border-radius:6px; border-width:0px; color:#ffffff; display:inline-block; font-size:14px; font-weight:normal; letter-spacing:0px; line-height:normal; padding:12px 18px 12px 18px; text-align:center; text-decoration:none; border-style:solid; width:600px;" target="_blank">Reset Password</a>
                          </td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                </tbody>
              </table><table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="f424383d-0101-4b99-b99a-8d428a219037" data-mc-module-version="2019-10-22">
              <tbody>
                <tr>
          <div style="font-family: inherit; text-align: inherit"><br></div>
          <div style="font-family: inherit; text-align: inherit">The above link will remain active for 30 minutes.</div>
          <div style="font-family: inherit; text-align: inherit"><br></div>
          <div style="font-family: inherit; text-align: inherit">To ensure security, we limit the number of password resets to 1 per month. If you have forgotten your password and need access, ask your org admin to contact us @2314635567. If you are the admin, please contact us at the provided phone number.</div><div></div></div></td>
                </tr>
              </tbody>
            </table><div data-role="module-unsubscribe" class="module" role="module" data-type="unsubscribe" style="color:#444444; font-size:12px; line-height:20px; padding:16px 16px 16px 16px; text-align:Center;" data-muid="4e838cf3-9892-4a6d-94d6-170e474d21e5"><div class="Unsubscribe--addressLine"></div><p style="font-size:12px; line-height:20px;"><a class="Unsubscribe--unsubscribeLink" href="{{{unsubscribe}}}" target="_blank" style="">Unsubscribe</a> - <a href="{{{unsubscribe_preferences}}}" target="_blank" class="Unsubscribe--unsubscribePreferences" style="">Unsubscribe Preferences</a></p></div></td>
                                                </tr>
                                              </table>
                                              <!--[if mso]>
                                            </td>
                                          </tr>
                                        </table>
                                      </center>
                                      <![endif]-->
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </div>
                </center>
              </body>
            </html>`,
        };

        console.log("calling transporter");
        // call transporter to send email
        transporter.sendMail(mail_options, (error, info) => {
          if (error) {
            console.error("Email sending error:", error);
          } else {
            console.log("Email sent:", info);
          }
        });

        res.status(200).json({
          message: "Password Reset Link Sent",
        });
      } else {
        res.status(404).json({
          message: "We could not find the user associated with the email",
        });
      }
    }
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

app.post("/reset-password", async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { id, password } = req.body;

    if (id && password) {
      const user = await User.findOne({ user_id: id });
      if (user?.email) {
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        await User.findOneAndUpdate(
          { user_id: id },
          {
            password: hashedPassword,
          }
        );

        res.status(200).json({
          message: "Password Reset",
        });
      } else {
        const client_user = await ClientUser.findOne({ client_user_id: id });
        if (client_user?.client_user_email) {
          const saltRounds = 10;
          const hashedPassword = await bcrypt.hash(password, saltRounds);

          await ClientUser.findOneAndUpdate(
            { client_user_id: id },
            {
              client_user_password: hashedPassword,
            }
          );

          res.status(200).json({
            message: "Password Reset",
          });
        } else {
          res.status(404).json({
            message: "Could not find a user with the associated id",
          });
        }
      }
    } else {
      res.status(500).json({
        message: "Please provide a password and id",
      });
    }
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

app.post("/create-connect-account", authenticateJWT, async (req, res) => {
  try {
    const user = req.user.user;

    const organization = await Organization.findOne({
      org_id: user.organization.org_id,
    });

    if (user && organization.billing.customer) {
      const stripe = require("stripe")(process.env.STRIPE_TEST);

      const account = await stripe.accounts.create({
        type: "express",
      });

      if (account) {
        await Organization.findOneAndUpdate(
          { org_id: user.organization.org_id },
          {
            stripe_account: account,
          }
        );

        // LIVE
        const accountLinks = await stripe.accountLinks.create({
          account: account.id,
          refresh_url: "https://kamariteams.com/", // URL to redirect if user closes Stripe page
          return_url: "https://kamariteams.com/", // URL to redirect after completion
          type: "account_onboarding",
        });

        // TEST
        // const accountLinks = await stripe.accountLinks.create({
        //   account: account.id,
        //   refresh_url: 'http:localhost:5173/', // URL to redirect if user closes Stripe page
        //   return_url: 'http:localhost:5173/', // URL to redirect after completion
        //   type: 'account_onboarding',
        // });

        if (accountLinks) {
          res.status(200).json({
            message: "Link created",
            connect_url: accountLinks.url,
          });
        } else {
          res.status(400).json({
            message:
              "There was a problem created a link to create a connect account. Please try again later.",
          });
        }
      } else {
        res.status(400).json({
          message: "There was an issue creating your stripe connect account",
        });
      }
    } else {
      res.status(400).json({
        message: "There was an error authenticating your request",
      });
    }
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

app.post("/invoices", authenticateJWT, async (req, res) => {
  try {
    const user = req.user.user;

    if (user) {
      const { task_ids, client_id, title } = req.body;

      dbConnect(process.env.GEN_AUTH);

      const tasks = await Task.find({ task_id: { $in: task_ids } });

      const organization = await Organization.findOne({
        org_id: user.organization.org_id,
      });

      if (organization?.stripe_account?.id) {
        const db_user = await User.findOne({ user_id: user.user_id });
        const db_user_price = db_user.hourly_rate;
        const stripe_invoice_price = db_user_price * 100;

        function calculateHours(task, existing_dead_hours) {
          const seconds_to_bill = task.billed_duration
            ? task.duration - task.billed_duration
            : task.duration;
          const hours_to_bill = Math.floor(seconds_to_bill / (60 * 60 * 1000));

          const dead_hours =
            (
              (seconds_to_bill / (60 * 60 * 1000)).toFixed(3) - hours_to_bill
            ).toFixed(3) + existing_dead_hours;
          return { hours_to_bill, dead_hours };
        }

        const client = await Client.findOne({ client_id });

        if (client.client_users[0].stripe_customer.id) {
          const stripe = require("stripe")(process.env.STRIPE_TEST);

          const client_metadata = JSON.stringify({
            client_id: client.client_id,
            client_name: client.client_name,
          });

          const invoice = await stripe.invoices.create({
            customer: client.client_users[0].stripe_customer.id, // Replace 'customer_id' with your actual customer ID
            collection_method: "send_invoice", // This can be 'send_invoice' or 'charge_automatically' based on your preference
            days_until_due: 7, // Adjust as needed
            on_behalf_of: organization.stripe_account.id,
            statement_descriptor: organization.name,
            issuer: {
              type: "account",
              account: organization.stripe_account.id,
            },
            metadata: {
              client: client_metadata
            },
            transfer_data: {
              destination: organization.stripe_account.id,
            },
          });

          if (invoice) {
            let client_dead_hours = 0;
            for (let task of tasks) {
              const existing_dead_hours = client.dead_hours
                ? client.dead_hours
                : 0;
              const { hours_to_bill, dead_hours } = calculateHours(
                task,
                existing_dead_hours
              );
              client_dead_hours = parseFloat(client_dead_hours) + parseFloat(dead_hours);
              await stripe.invoiceItems.create({
                customer: client.client_users[0].stripe_customer.id,
                invoice: invoice.id,
                description: task.title,
                unit_amount: stripe_invoice_price,
                quantity: hours_to_bill,
                metadata: {
                  project: task.project
                    ? {
                        project_id: task.project.project_id,
                        title: task.project.title,
                        status: task.project.status,
                        description: task.project.description
                          ? task.project.description
                          : "",
                      }
                    : null,
                },
              });

              if (client_dead_hours > 0.0) {
                await Client.findOneAndUpdate(
                  { client_id },
                  {
                    dead_hours: client_dead_hours,
                  }
                );
              }

              const finalized_invoice = await stripe.invoices.finalizeInvoice(
                invoice.id
              );

              res.status(200).json({
                message: "Invoice Created",
                invoic: finalized_invoice,
                dead_hours: client_dead_hours,
              });
            }
          } else {
            res.status(500).json({
              message: "There was an issue creating your invoice",
            });
          }
        } else {
          res.status(404).json({
            message: "Could not find customer for associated client",
          });
        }
      } else {
        res.status(404).json({
          message: "Stripe account not found",
        });
      }
    } else {
      res.status(409).json({
        message: "Authentication Invalid",
      });
    }
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

app.get("/invoices", authenticateJWT, async (req, res) => {
  try {
    const user = req.user.user;

    const { type, chunk } = req.query;

    if (user) {
      dbConnect(process.env.GEN_AUTH);

      const organization = await Organization.findOne({
        org_id: user.organization.org_id,
      });

      if (organization) {
        const connect_account_id = organization?.stripe_account?.id;
        if (connect_account_id) {
          const stripe = require("stripe")(process.env.STRIPE_TEST);

          if (type && type !== "expanded") {
            const all_invoices = [];
            let has_more = true; // Assuming you have a way to determine whether there are more invoices

            let invoices = await stripe.invoices.list({
              limit: parseInt(chunk),
              status: type,
            });

            has_more = invoices.has_more;

            all_invoices.push(...invoices.data);

            while (has_more) {
              if (invoices.has_more) {
                invoices = await stripe.invoices.list({
                  limit: parseInt(chunk),
                  status: type,
                  starting_after: all_invoices[all_invoices.length - 1].id,
                });
                all_invoices.push(...invoices.data);
                has_more = invoices.has_more;
              } else {
                has_more = false;
              }
            }

            res.status(200).json({
              message: "Invoices found an aggregated",
              count: all_invoices.length,
              invoices: all_invoices,
            });
          } else if (type && type === "expanded") {
            const invoices = [];
            let has_more = false;
            const invoice_types = ["paid", "open"];

            for (let invoice_type of invoice_types) {
              let these_invoices = await stripe.invoices.list({
                limit: parseInt(chunk),
                status: invoice_type,
              });
              invoices.push(...these_invoices.data);

              if (these_invoices.has_more) {
                has_more = true;
              }
              while (has_more) {
                these_invoices = await stripe.invoices.list({
                  limit: parseInt(chunk),
                  starting_after: invoices[invoices.length - 1].id,
                  status: invoice_type,
                });

                has_more = these_invoices.has_more;
                invoices.push(...these_invoices.data);
              }
            }

            res.status(200).json({
              message: "Invoices found and aggregated",
              count: invoices.length,
              invoices,
            });
          }
          // else {
          //   const invoices = await stripe.invoices.list({
          //     limit: parseInt(chunk),
          //     status: type,
          //   });

          //   res.status(200).json({
          //     message: "Invoices found",
          //     count: invoices.length,
          //     invoices: invoices.data,
          //   });
          // }
        } else {
          res.status(404).json({
            message:
              "Could not find a connect account associated with user organization",
          });
        }
      } else {
        res.status(409).json({
          message: "Authentication Invalid",
        });
      }
    } else {
      res.status(409).json({
        message: "Authentication Invalid",
      });
    }
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

app.get("/organization", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const user = req.user.user;

    const organization = await Organization.findOne({
      org_id: user.organization.org_id,
    });

    if (organization) {
      const billing = organization.billing;

      if (billing.id) {
        const stripe = require("stripe")(process.env.STRIPE_TEST);
        const subscription = await stripe.subscriptions.retrieve(billing.id);

        if (subscription) {
          const updated_org = await Organization.findOneAndUpdate(
            { org_id: organization.org_id },
            {
              billing: subscription,
            },
            {
              $new: true,
            }
          );
          res.status(200).json({
            message: "Organization Found",
            organization: updated_org,
          });
        } else {
          res.status(200).json({
            message: "Organization Found",
            organization,
          });
        }
      } else {
        res.status(200).json({
          message: "Organization Found",
          organization,
        });
      }
    } else {
      res.status(404).json({
        message:
          "No organization found associated with the authenticating user",
        organization: user.organization,
      });
    }
  } catch (error) {
    res.status(500).json({
      message: error,
    });
  }
});

app.get("/client-documents", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const client_id = req.user.client_id;

    if (client_id) {
      const documents = await Document.find({
        "document_client.client_id": client_id,
      });

      res.status(200).json({
        message: "Documents Found",
        count: documents.length,
        documents,
      });
    } else {
      res.status(409).json({
        message: "No client id associated with auth",
      });
    }
  } catch (error) {
    res.status(500).json({
      message: error,
    });
  }
});

app.get("/documents", authenticateJWT, async (req, res) => {
  try {
    await dbConnect(process.env.GEN_AUTH);
    // Assuming req.user.organization holds the user's organization details
    const org_id = req.user?.user?.organization?.org_id;

    const { doc_id } = req.query;

    if (!doc_id) {
      const documents = await Document.find({
        "associated_org.org_id": org_id,
      }).select(
        "document_id title is_public document_client document_folder contributors -_id"
      );

      // Send the documents as a response
      res.status(200).json({
        count: documents.length,
        documents,
      });
    } else {
      const documents = await Document.findOne({ document_id: doc_id });

      if (documents) {
        res.status(200).json({
          count: documents.length,
          documents,
        });
      } else {
        res.status(404).json({
          message: `No document with the id of ${doc_id} was found`,
        });
      }
    }
    // Use the org_id to find documents and select specific fields
  } catch (error) {
    res.status(500).json({
      message: error.message,
      requested_resource: req.query,
    });
  }
});

app.get("/public_doc", async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { doc_id } = req.query;

    const document = await Document.findOne({ document_id: doc_id });

    if (document) {
      if (
        document.is_public === true &&
        document.associated_org.status === "active"
      ) {
        const returnable_document = {
          content: document.content,
        };
        const returnable_org = {
          name: document.associated_org.name,
        };
        res.status(200).json({
          message: "Document Found",
          document: returnable_document,
          organization: returnable_org,
        });
      } else {
        res.status(409).json({
          message: "Document is not Public or Org is not active",
          is_public: document.is_public,
        });
      }
    } else {
      res.status(404).json({
        message: "Document Not Found. No Document Exists with the specified id",
        requested_resource: req.query.doc_id,
      });
    }
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

app.put("/update-project", authenticateJWT, async (req, res) => {
  try {
    const client_id = req.user.client_id;

    if (client_id) {
      dbConnect(process.env.GEN_AUTH);

      const { project_id, title, description, budget, status } = req.body;

      await Project.findOneAndUpdate(
        { project_id },
        {
          $set: {
            title,
            description,
            status,
            budget,
          },
        },
        {
          $new: true,
        }
      );

      res.status(200).json({
        message: "Project Updated",
      });
    } else {
      res.status(409).json({
        message: "Authentication Invalid",
      });
    }
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

app.post("/project", authenticateJWT, async (req, res) => {
  try {
    const client_id = req.user.client_id;

    if (!client_id) {
      res.status(409).json({
        message: "Unauthorized access",
      });
    } else {
      dbConnect(process.env.GEN_AUTH);

      const client = await Client.findOne({ client_id });

      if (!client) {
        res.status(404).json({
          message: "No client found.. unauthorized",
        });
      } else {
        const { title, description, budget } = req.body;
        const project_id = uuidv4();
        const newProject = new Project({
          project_id,
          title,
          organization: client.associated_org,
          status: {
            title: "In Progress",
            color: "#2EC4B6",
            softerColor: "rgba(46, 196, 182, 0.3)", // Softer color with reduced opacity
          },
          client: {
            client_id: client.client_id,
            client_poc: client.client_poc,
            client_name: client.client_name,
          },
          total_time: 0,
          cost: 0,
          description,
          budget: budget,
          invoices: [],
        });

        const savedProject = await newProject.save();

        res.status(200).json({
          message: "Project saved",
          project: savedProject,
        });
      }
    }
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

app.get("/projects", authenticateJWT, async (req, res) => {
  try {
    const client_id = req.user.client_id;
    const user = req.user.user;

    if (!client_id && !user) {
      res.status(409).json({
        message: "Invalid authentication. Please provide token.",
      });
    } else {
      dbConnect(process.env.GEN_AUTH);
      if (user && !client_id) {
        const projects = await Project.find({
          "organization.org_id": user.organization.org_id,
        });

        res.status(200).json({
          message: "Projects found",
          count: projects.length,
          projects,
        });
      } else if (!user && client_id) {
        const projects = await Project.find({ "client.client_id": client_id });

        res.status(200).json({
          message: "Projects found",
          count: projects.length,
          projects,
        });
      }
    }
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

app.post("/folders", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);
    const folder_id = uuidv4();
    const { name, client, documents, description } = req.body;
    const user = req.user.user;

    console.log("logging user", user);

    const newFolder = new Folder({
      folder_id,
      associated_org: user.organization,
      documents,
      name,
      created_by: user,
      client,
      description,
    });

    console.log("New Folder", newFolder);

    const created_folder = await newFolder.save();

    console.log("Created Folder");

    res.status(200).json({
      message: "Folder Created",
      created_resource: created_folder,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

app.get("/folders", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    // Assuming req.user.organization holds the user's organization details
    const org_id = req.user.user.organization.org_id;

    // Use the org_id to find documents
    const folders = await Folder.find({ "associated_org.org_id": org_id });

    // Send the documents as a response
    res.status(200).json({
      count: folders.length,
      folders,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

// app.post("/clients", authenticateJWT, async (req, res) => {
//   try {
//     dbConnect(process.env.GEN_AUTH);
//     const client_id = uuidv4();
//     const associated_org = req.user.organization;
//     const user = req.user;
//     const {  } = req.body;

//   } catch (error) {
//     res.status(500).json({
//       message: error.message
//     });
//   }
// })

app.post("/client-invitation", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const associated_org = req.user.user.organization;
    const invitation_id = uuidv4();
    const { client_email, refreshSend = false } = req.body;

    console.log(client_email, invitation_id, associated_org);

    let created_client_invitation = {};

    if (refreshSend) {
      created_client_invitation = await ClientInvitation.findOneAndUpdate(
        { client_email },
        {
          status: "unaccepted",
        },
        {
          $new: true,
        }
      );
    } else {
      const newClientInvitation = new ClientInvitation({
        invitation_id,
        associated_org,
        status: "unaccepted",
        client_email,
        invite_url: `https://kamariteams.com/client-signup?email=${client_email}&type=client&org_id=${associated_org.org_id}&invitation_id=${invitation_id}`,
      });

      created_client_invitation = await newClientInvitation.save();
    }

    console.log(created_client_invitation);

    // generate email content
    const mail_options = {
      from: `"Kamari" <contact@kamariteams.com>`,
      to: client_email, // The user's email address
      subject: "You're Invited to Kamari",
      text: `${associated_org.name} sent you an invite to join Kamari. 
      Manage your product pipeline without having to send a million emails. 
      To get started click the "Create Account" button below!`,
      html: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
      <html data-editor-version="2" class="sg-campaigns" xmlns="http://www.w3.org/1999/xhtml">
          <head>
            <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1">
            <!--[if !mso]><!-->
            <meta http-equiv="X-UA-Compatible" content="IE=Edge">
            <!--<![endif]-->
            <!--[if (gte mso 9)|(IE)]>
            <xml>
              <o:OfficeDocumentSettings>
                <o:AllowPNG/>
                <o:PixelsPerInch>96</o:PixelsPerInch>
              </o:OfficeDocumentSettings>
            </xml>
            <![endif]-->
            <!--[if (gte mso 9)|(IE)]>
        <style type="text/css">
          body {width: 600px;margin: 0 auto;}
          table {border-collapse: collapse;}
          table, td {mso-table-lspace: 0pt;mso-table-rspace: 0pt;}
          img {-ms-interpolation-mode: bicubic;}
        </style>
      <![endif]-->
            <style type="text/css">
          body, p, div {
            font-family: arial,helvetica,sans-serif;
            font-size: 14px;
          }
          body {
            color: #000000;
          }
          body a {
            color: #1188E6;
            text-decoration: none;
          }
          p { margin: 0; padding: 0; }
          table.wrapper {
            width:100% !important;
            table-layout: fixed;
            -webkit-font-smoothing: antialiased;
            -webkit-text-size-adjust: 100%;
            -moz-text-size-adjust: 100%;
            -ms-text-size-adjust: 100%;
          }
          img.max-width {
            max-width: 100% !important;
          }
          .column.of-2 {
            width: 50%;
          }
          .column.of-3 {
            width: 33.333%;
          }
          .column.of-4 {
            width: 25%;
          }
          ul ul ul ul  {
            list-style-type: disc !important;
          }
          ol ol {
            list-style-type: lower-roman !important;
          }
          ol ol ol {
            list-style-type: lower-latin !important;
          }
          ol ol ol ol {
            list-style-type: decimal !important;
          }
          @media screen and (max-width:480px) {
            .preheader .rightColumnContent,
            .footer .rightColumnContent {
              text-align: left !important;
            }
            .preheader .rightColumnContent div,
            .preheader .rightColumnContent span,
            .footer .rightColumnContent div,
            .footer .rightColumnContent span {
              text-align: left !important;
            }
            .preheader .rightColumnContent,
            .preheader .leftColumnContent {
              font-size: 80% !important;
              padding: 5px 0;
            }
            table.wrapper-mobile {
              width: 100% !important;
              table-layout: fixed;
            }
            img.max-width {
              height: auto !important;
              max-width: 100% !important;
            }
            a.bulletproof-button {
              display: block !important;
              width: auto !important;
              font-size: 80%;
              padding-left: 0 !important;
              padding-right: 0 !important;
            }
            .columns {
              width: 100% !important;
            }
            .column {
              display: block !important;
              width: 100% !important;
              padding-left: 0 !important;
              padding-right: 0 !important;
              margin-left: 0 !important;
              margin-right: 0 !important;
            }
            .social-icon-column {
              display: inline-block !important;
            }
          }
        </style>
            <!--user entered Head Start--><!--End Head user entered-->
          </head>
          <body>
            <center class="wrapper" data-link-color="#1188E6" data-body-style="font-size:14px; font-family:arial,helvetica,sans-serif; color:#000000; background-color:#FFFFFF;">
              <div class="webkit">
                <table cellpadding="0" cellspacing="0" border="0" width="100%" class="wrapper" bgcolor="#FFFFFF">
                  <tr>
                    <td valign="top" bgcolor="#FFFFFF" width="100%">
                      <table width="100%" role="content-container" class="outer" align="center" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td width="100%">
                            <table width="100%" cellpadding="0" cellspacing="0" border="0">
                              <tr>
                                <td>
                                  <!--[if mso]>
          <center>
          <table><tr><td width="600">
        <![endif]-->
                                          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px;" align="center">
                                            <tr>
                                              <td role="modules-container" style="padding:0px 0px 0px 0px; color:#000000; text-align:left;" bgcolor="#FFFFFF" width="100%" align="left"><table class="module preheader preheader-hide" role="module" data-type="preheader" border="0" cellpadding="0" cellspacing="0" width="100%" style="display: none !important; mso-hide: all; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0;">
          <tr>
            <td role="module-content">
              <p></p>
            </td>
          </tr>
        </table><table border="0" cellpadding="0" cellspacing="0" align="center" width="100%" role="module" data-type="columns" style="padding:0px 0px 0px 0px;" bgcolor="#FFFFFF" data-distribution="1,1">
          <tbody>
            <tr role="module-content">
              <td height="100%" valign="top"><table width="290" style="width:290px; border-spacing:0; border-collapse:collapse; margin:0px 10px 0px 0px;" cellpadding="0" cellspacing="0" align="left" border="0" bgcolor="" class="column column-0">
            <tbody>
              <tr>
                <td style="padding:0px;margin:0px;border-spacing:0;"><table class="wrapper" role="module" data-type="image" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="dBRBKqWsYgsricgDWAGd23">
          <tbody>
            <tr>
              <td style="font-size:6px; line-height:10px; padding:0px 0px 0px 0px;" valign="top" align="center">
                <img class="max-width" border="0" style="display:block; color:#000000; text-decoration:none; font-family:Helvetica, arial, sans-serif; font-size:16px; max-width:100% !important; width:100%; height:auto !important;" width="290" alt="" data-proportionally-constrained="true" data-responsive="true" src="http://cdn.mcauto-images-production.sendgrid.net/92bbbf50563199d0/680603af-7415-4fdd-9736-6be7e0a29757/1000x500.png">
              </td>
            </tr>
          </tbody>
        </table></td>
              </tr>
            </tbody>
          </table><table width="290" style="width:290px; border-spacing:0; border-collapse:collapse; margin:0px 0px 0px 10px;" cellpadding="0" cellspacing="0" align="left" border="0" bgcolor="" class="column column-1">
            <tbody>
              <tr>
                <td style="padding:0px;margin:0px;border-spacing:0;"><table class="module" role="module" data-type="spacer" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="df8d00a9-5a76-4676-82f5-bea1fc2597ae">
          <tbody>
            <tr>
              <td style="padding:0px 0px 30px 0px;" role="module-content" bgcolor="">
              </td>
            </tr>
          </tbody>
        </table><table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="e91ZwuHxUeknHu24krPgcX" data-mc-module-version="2019-10-22">
          <tbody>
            <tr>
              <td style="padding:18px 0px 18px 0px; line-height:22px; text-align:inherit;" height="100%" valign="top" bgcolor="" role="module-content"><div><div style="font-family: inherit; text-align: inherit">Someone sent you an invite to Kamari</div><div></div></div></td>
            </tr>
          </tbody>
        </table></td>
              </tr>
            </tbody>
          </table></td>
            </tr>
          </tbody>
        </table><table border="0" cellpadding="0" cellspacing="0" class="module" data-role="module-button" data-type="button" role="module" style="table-layout:fixed;" width="100%" data-muid="235b3326-6bfd-4935-b039-dbf42dae480e">
            <tbody>
              <tr>
                <td align="right" bgcolor="" class="outer-td" style="padding:0px 0px 0px 0px;">
                  <table border="0" cellpadding="0" cellspacing="0" class="wrapper-mobile" style="text-align:center;">
                    <tbody>
                      <tr>
                      <td align="center" bgcolor="#be4bff" class="inner-td" style="border-radius:6px; font-size:16px; text-align:right; background-color:inherit;">
                        <a href="https://kamariteams.com/client-signup?email=${client_email}&type=client&org_id=${associated_org.org_id}&invitation_id=${invitation_id}" style="background-color:#be4bff; border:0px solid #333333; border-color:#333333; border-radius:6px; border-width:0px; color:#ffffff; display:inline-block; font-size:14px; font-weight:normal; letter-spacing:0px; line-height:normal; padding:12px 18px 12px 18px; text-align:center; text-decoration:none; border-style:solid; width:600px;" target="_blank">Get Kamari for Free</a>
                      </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table><table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="f424383d-0101-4b99-b99a-8d428a219037" data-mc-module-version="2019-10-22">
          <tbody>
            <tr>
              <td style="padding:18px 0px 18px 0px; line-height:22px; text-align:inherit;" height="100%" valign="top" bgcolor="" role="module-content"><div><div style="font-family: inherit; text-align: inherit">${associated_org.name} sent you an invite to Kamari.</div>
      <div style="font-family: inherit; text-align: inherit"><br></div>
      <div style="font-family: inherit; text-align: inherit">Join Kamari Client for free and manage your product pipeline from ideation to delivery.</div>
      <div style="font-family: inherit; text-align: inherit"><br></div>
      <div style="font-family: inherit; text-align: inherit">Provide insights to the developers building your product with KPI analysis and manage product sprints and timelines with input from the dev org.</div><div></div></div></td>
            </tr>
          </tbody>
        </table><div data-role="module-unsubscribe" class="module" role="module" data-type="unsubscribe" style="color:#444444; font-size:12px; line-height:20px; padding:16px 16px 16px 16px; text-align:Center;" data-muid="4e838cf3-9892-4a6d-94d6-170e474d21e5"><div class="Unsubscribe--addressLine"></div><p style="font-size:12px; line-height:20px;"><a class="Unsubscribe--unsubscribeLink" href="{{{unsubscribe}}}" target="_blank" style="">Unsubscribe</a> - <a href="{{{unsubscribe_preferences}}}" target="_blank" class="Unsubscribe--unsubscribePreferences" style="">Unsubscribe Preferences</a></p></div></td>
                                            </tr>
                                          </table>
                                          <!--[if mso]>
                                        </td>
                                      </tr>
                                    </table>
                                  </center>
                                  <![endif]-->
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </div>
            </center>
          </body>
        </html>`,
      headers: {
        "List-Unsubscribe": `<mailto:contact@kamariteams.com>, <https://kamariteams.com/unsubscribe?email=${client_email}>`,
      },
    };

    console.log("calling transporter");
    // call transporter to send email
    transporter.sendMail(mail_options, (error, info) => {
      if (error) {
        console.error("Email sending error:", error);
      } else {
        console.log("Email sent:", info);
      }
    });
    console.log("transporter called");

    console.log("email sent");

    res.status(200).json({
      message: "Client Invite Sent",
      mail_options: mail_options,
    });
  } catch (error) {
    res.status(500).json({ status: 500, message: error });
  }
});

app.post("/team-invitation", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const associated_org = req.user.user.organization;
    const invitation_id = uuidv4();
    const { team_member_email, type } = req.body;

    console.log("1", team_member_email, type, associated_org);

    const newTeamInvitation = new TeamInvitation({
      invitation_id,
      associated_org,
      status: "unaccepted",
      team_member_email,
      invite_url: `https://kamariteams.com/team-signup?email=${team_member_email}&type=${type}&org_id=${associated_org.org_id}&invitation_id=${invitation_id}`,
    });

    console.log("2", newTeamInvitation);

    const created_team_invitation = await newTeamInvitation.save();

    // generate email content
    const mail_options = {
      from: `"Kamari" <contact@kamariteams.com>`,
      to: team_member_email, // The user's email address
      subject: `${associated_org.name} sent you a team invite`,
      text: `An admin from ${associated_org.name} invited you to join their team`,
      html: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
      <html data-editor-version="2" class="sg-campaigns" xmlns="http://www.w3.org/1999/xhtml">
          <head>
            <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1">
            <!--[if !mso]><!-->
            <meta http-equiv="X-UA-Compatible" content="IE=Edge">
            <!--<![endif]-->
            <!--[if (gte mso 9)|(IE)]>
            <xml>
              <o:OfficeDocumentSettings>
                <o:AllowPNG/>
                <o:PixelsPerInch>96</o:PixelsPerInch>
              </o:OfficeDocumentSettings>
            </xml>
            <![endif]-->
            <!--[if (gte mso 9)|(IE)]>
        <style type="text/css">
          body {width: 600px;margin: 0 auto;}
          table {border-collapse: collapse;}
          table, td {mso-table-lspace: 0pt;mso-table-rspace: 0pt;}
          img {-ms-interpolation-mode: bicubic;}
        </style>
      <![endif]-->
            <style type="text/css">
          body, p, div {
            font-family: arial,helvetica,sans-serif;
            font-size: 14px;
          }
          body {
            color: #000000;
          }
          body a {
            color: #1188E6;
            text-decoration: none;
          }
          p { margin: 0; padding: 0; }
          table.wrapper {
            width:100% !important;
            table-layout: fixed;
            -webkit-font-smoothing: antialiased;
            -webkit-text-size-adjust: 100%;
            -moz-text-size-adjust: 100%;
            -ms-text-size-adjust: 100%;
          }
          img.max-width {
            max-width: 100% !important;
          }
          .column.of-2 {
            width: 50%;
          }
          .column.of-3 {
            width: 33.333%;
          }
          .column.of-4 {
            width: 25%;
          }
          ul ul ul ul  {
            list-style-type: disc !important;
          }
          ol ol {
            list-style-type: lower-roman !important;
          }
          ol ol ol {
            list-style-type: lower-latin !important;
          }
          ol ol ol ol {
            list-style-type: decimal !important;
          }
          @media screen and (max-width:480px) {
            .preheader .rightColumnContent,
            .footer .rightColumnContent {
              text-align: left !important;
            }
            .preheader .rightColumnContent div,
            .preheader .rightColumnContent span,
            .footer .rightColumnContent div,
            .footer .rightColumnContent span {
              text-align: left !important;
            }
            .preheader .rightColumnContent,
            .preheader .leftColumnContent {
              font-size: 80% !important;
              padding: 5px 0;
            }
            table.wrapper-mobile {
              width: 100% !important;
              table-layout: fixed;
            }
            img.max-width {
              height: auto !important;
              max-width: 100% !important;
            }
            a.bulletproof-button {
              display: block !important;
              width: auto !important;
              font-size: 80%;
              padding-left: 0 !important;
              padding-right: 0 !important;
            }
            .columns {
              width: 100% !important;
            }
            .column {
              display: block !important;
              width: 100% !important;
              padding-left: 0 !important;
              padding-right: 0 !important;
              margin-left: 0 !important;
              margin-right: 0 !important;
            }
            .social-icon-column {
              display: inline-block !important;
            }
          }
        </style>
            <!--user entered Head Start--><!--End Head user entered-->
          </head>
          <body>
            <center class="wrapper" data-link-color="#1188E6" data-body-style="font-size:14px; font-family:arial,helvetica,sans-serif; color:#000000; background-color:#FFFFFF;">
              <div class="webkit">
                <table cellpadding="0" cellspacing="0" border="0" width="100%" class="wrapper" bgcolor="#FFFFFF">
                  <tr>
                    <td valign="top" bgcolor="#FFFFFF" width="100%">
                      <table width="100%" role="content-container" class="outer" align="center" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td width="100%">
                            <table width="100%" cellpadding="0" cellspacing="0" border="0">
                              <tr>
                                <td>
                                  <!--[if mso]>
          <center>
          <table><tr><td width="600">
        <![endif]-->
                                          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px;" align="center">
                                            <tr>
                                              <td role="modules-container" style="padding:0px 0px 0px 0px; color:#000000; text-align:left;" bgcolor="#FFFFFF" width="100%" align="left"><table class="module preheader preheader-hide" role="module" data-type="preheader" border="0" cellpadding="0" cellspacing="0" width="100%" style="display: none !important; mso-hide: all; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0;">
          <tr>
            <td role="module-content">
              <p></p>
            </td>
          </tr>
        </table><table border="0" cellpadding="0" cellspacing="0" align="center" width="100%" role="module" data-type="columns" style="padding:0px 0px 0px 0px;" bgcolor="#FFFFFF" data-distribution="1,1">
          <tbody>
            <tr role="module-content">
              <td height="100%" valign="top"><table width="290" style="width:290px; border-spacing:0; border-collapse:collapse; margin:0px 10px 0px 0px;" cellpadding="0" cellspacing="0" align="left" border="0" bgcolor="" class="column column-0">
            <tbody>
              <tr>
                <td style="padding:0px;margin:0px;border-spacing:0;"><table class="wrapper" role="module" data-type="image" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="dBRBKqWsYgsricgDWAGd23">
          <tbody>
            <tr>
              <td style="font-size:6px; line-height:10px; padding:0px 0px 0px 0px;" valign="top" align="center">
                <img class="max-width" border="0" style="display:block; color:#000000; text-decoration:none; font-family:Helvetica, arial, sans-serif; font-size:16px; max-width:100% !important; width:100%; height:auto !important;" width="290" alt="" data-proportionally-constrained="true" data-responsive="true" src="http://cdn.mcauto-images-production.sendgrid.net/92bbbf50563199d0/680603af-7415-4fdd-9736-6be7e0a29757/1000x500.png">
              </td>
            </tr>
          </tbody>
        </table></td>
              </tr>
            </tbody>
          </table><table width="290" style="width:290px; border-spacing:0; border-collapse:collapse; margin:0px 0px 0px 10px;" cellpadding="0" cellspacing="0" align="left" border="0" bgcolor="" class="column column-1">
            <tbody>
              <tr>
                <td style="padding:0px;margin:0px;border-spacing:0;"><table class="module" role="module" data-type="spacer" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="df8d00a9-5a76-4676-82f5-bea1fc2597ae">
          <tbody>
            <tr>
              <td style="padding:0px 0px 30px 0px;" role="module-content" bgcolor="">
              </td>
            </tr>
          </tbody>
        </table><table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="e91ZwuHxUeknHu24krPgcX" data-mc-module-version="2019-10-22">
          <tbody>
            <tr>
              <td style="padding:18px 0px 18px 0px; line-height:22px; text-align:inherit;" height="100%" valign="top" bgcolor="" role="module-content"><div><div style="font-family: inherit; text-align: inherit">Someone on your team wants you to join Kamari to manage docs, clients, and more!</div><div></div></div></td>
            </tr>
          </tbody>
        </table></td>
              </tr>
            </tbody>
          </table></td>
            </tr>
          </tbody>
        </table><table border="0" cellpadding="0" cellspacing="0" class="module" data-role="module-button" data-type="button" role="module" style="table-layout:fixed;" width="100%" data-muid="235b3326-6bfd-4935-b039-dbf42dae480e">
            <tbody>
              <tr>
                <td align="right" bgcolor="" class="outer-td" style="padding:0px 0px 0px 0px;">
                  <table border="0" cellpadding="0" cellspacing="0" class="wrapper-mobile" style="text-align:center;">
                    <tbody>
                      <tr>
                      <td align="center" bgcolor="#be4bff" class="inner-td" style="border-radius:6px; font-size:16px; text-align:right; background-color:inherit;">
                        <a href="${newTeamInvitation.invite_url}" style="background-color:#be4bff; border:0px solid #333333; border-color:#333333; border-radius:6px; border-width:0px; color:#ffffff; display:inline-block; font-size:14px; font-weight:normal; letter-spacing:0px; line-height:normal; padding:12px 18px 12px 18px; text-align:center; text-decoration:none; border-style:solid; width:600px;" target="_blank">Join Your Team</a>
                      </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table><table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="f424383d-0101-4b99-b99a-8d428a219037" data-mc-module-version="2019-10-22">
          <tbody>
            <tr>
              <td style="padding:18px 0px 18px 0px; line-height:22px; text-align:inherit;" height="100%" valign="top" bgcolor="" role="module-content"><div><div style="font-family: inherit; text-align: inherit">${associated_org.name} sent you an invite to Kamari.</div>
      <div style="font-family: inherit; text-align: inherit"><br></div>
      <div style="font-family: inherit; text-align: inherit">Join Kamari Client for free and manage your product pipeline from ideation to delivery.</div>
      <div style="font-family: inherit; text-align: inherit"><br></div>
      <div style="font-family: inherit; text-align: inherit">Provide insights to the developers building your product with KPI analysis and manage product sprints and timelines with input from the dev org.</div><div></div></div></td>
            </tr>
          </tbody>
        </table><div data-role="module-unsubscribe" class="module" role="module" data-type="unsubscribe" style="color:#444444; font-size:12px; line-height:20px; padding:16px 16px 16px 16px; text-align:Center;" data-muid="4e838cf3-9892-4a6d-94d6-170e474d21e5"><div class="Unsubscribe--addressLine"></div><p style="font-size:12px; line-height:20px;"><a class="Unsubscribe--unsubscribeLink" href="{{{unsubscribe}}}" target="_blank" style="">Unsubscribe</a> - <a href="{{{unsubscribe_preferences}}}" target="_blank" class="Unsubscribe--unsubscribePreferences" style="">Unsubscribe Preferences</a></p></div></td>
                                            </tr>
                                          </table>
                                          <!--[if mso]>
                                        </td>
                                      </tr>
                                    </table>
                                  </center>
                                  <![endif]-->
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </div>
            </center>
          </body>
        </html>`,
      headers: {
        "List-Unsubscribe": `<mailto:contact@kamariteams.com>, <https://kamariteams.com/unsubscribe?email=${team_member_email}>`,
      },
    };

    console.log("calling transporter");
    // call transporter to send email
    transporter.sendMail(mail_options, (error, info) => {
      if (error) {
        console.error("Email sending error:", error);
      } else {
        console.log("Email sent:", info);
      }
    });
    console.log("transporter called");

    console.log("email sent");

    res.status(200).json({
      message: "Team Invite Sent",
      mail_options: mail_options,
    });
  } catch (error) {
    res.status(500).json({ status: 500, message: error });
  }
});

app.get("/tasks", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    console.log("FETCH TASKS 1");

    let { email, sprint_id } = req.query;

    console.log("FETCH TASKS 2");

    const client_id = req.user.client_id;

    console.log("CLIENT ID: ", client_id);
    console.log("QUERY PARAMS: ", email, sprint_id);

    console.log("STARTING COMPARISON");
    if (client_id !== undefined && client_id !== null) {
      log = 1;
      // Decode email if it's present
      if (email) {
        email = decodeURIComponent(email);
      }

      if (!email && !sprint_id) {
        console.log("FINDING TASKS BY CLIENT ID");
        const tasks = await Task.find({
          "client.client_id": client_id,
        });
        res.status(200).json({
          message: "Tasks Found",
          tasks,
          log: 1,
          request: req.query,
        });
      } else if (!email && sprint_id) {
        if (sprint_id === "All") {
          const tasks = await Task.find({
            "client.client_id": client_id,
          });
          res.status(200).json({
            message: "Tasks Found",
            tasks,
            log: 2,
            request: req.query,
          });
        } else if (sprint_id !== "All") {
          const tasks = await Task.find({
            sprint_id,
            "client.client_id": client_id,
          });
          res.status(200).json({
            message: "Tasks Found",
            tasks,
            log: 3,
            request: req.query,
          });
        }
      } else if (email && !sprint_id) {
        if (email === "All") {
          const tasks = await Task.find({
            "client.client_id": client_id,
          });
          res.status(200).json({
            message: "Tasks Found",
            tasks,
            log: 4,
            request: req.query,
          });
        } else if (email !== "All") {
          const tasks = await Task.find({
            "assignees.email": email,
            "client.client_id": client_id,
          });
          res.status(200).json({
            message: "Tasks Found",
            tasks,
            log: 5,
            request: req.query,
          });
        }
      } else if (email && sprint_id) {
        if (email === "All" && sprint_id === "All") {
          const tasks = await Task.find({
            "client.client_id": client_id,
          });
          res.status(200).json({
            message: "Tasks Found",
            tasks,
            log: 6,
            request: req.query,
          });
        } else if (email === "All" && sprint_id !== "All") {
          const tasks = await Task.find({
            sprint_id,
            "client.client_id": client_id,
          });
          res.status(200).json({
            message: "Tasks Found",
            tasks,
            log: 7,
            request: req.query,
          });
        } else if (email !== "All" && sprint_id === "All") {
          const tasks = await Task.find({
            "assignees.email": email,
            "client.client_id": client_id,
          });
          res.status(200).json({
            message: "Tasks Found",
            tasks,
            log: 8,
            request: req.query,
          });
        } else if (email !== "All" && sprint_id !== "All") {
          const tasks = await Task.find({
            sprint_id,
            "assignees.email": email,
            "client.client_id": client_id,
          });
          res.status(200).json({
            message: "Tasks Found",
            tasks,
            log: 9,
            request: req.query,
          });
        }
      } else {
        res.status(404).json({
          message: "Selection invalid",
        });
      }
    } else {
      console.log("FINDING TASKS BY USER DETAILS");
      // Decode email if it's present
      if (email) {
        email = decodeURIComponent(email);
      }

      // add authenticating user correlation check
      const authenticating_user = req.user.user;

      if (!email && !sprint_id) {
        const tasks = await Task.find({
          "assignees.email": authenticating_user.email,
        });
        res.status(200).json({
          message: "Tasks Found",
          tasks,
          log: 1,
          request: req.query,
        });
      } else if (!email && sprint_id) {
        if (sprint_id === "All") {
          const tasks = await Task.find({
            "organization.org_id": authenticating_user.organization.org_id,
          });
          res.status(200).json({
            message: "Tasks Found",
            tasks,
            log: 2,
            request: req.query,
          });
        } else if (sprint_id !== "All") {
          const tasks = await Task.find({ sprint_id });
          res.status(200).json({
            message: "Tasks Found",
            tasks,
            log: 3,
            request: req.query,
          });
        }
      } else if (email && !sprint_id) {
        if (email === "All") {
          const tasks = await Task.find({
            "organization.org_id": authenticating_user.organization.org_id,
          });
          res.status(200).json({
            message: "Tasks Found",
            tasks,
            log: 4,
            request: req.query,
          });
        } else if (email !== "All") {
          const tasks = await Task.find({ "assignees.email": email });
          res.status(200).json({
            message: "Tasks Found",
            tasks,
            log: 5,
            request: req.query,
          });
        }
      } else if (email && sprint_id) {
        if (email === "All" && sprint_id === "All") {
          const tasks = await Task.find({
            "organization.org_id": authenticating_user.organization.org_id,
          });
          res.status(200).json({
            message: "Tasks Found",
            tasks,
            log: 6,
            request: req.query,
          });
        } else if (email === "All" && sprint_id !== "All") {
          const tasks = await Task.find({ sprint_id });
          res.status(200).json({
            message: "Tasks Found",
            tasks,
            log: 7,
            request: req.query,
          });
        } else if (email !== "All" && sprint_id === "All") {
          const tasks = await Task.find({ "assignees.email": email });
          res.status(200).json({
            message: "Tasks Found",
            tasks,
            log: 8,
            request: req.query,
          });
        } else if (email !== "All" && sprint_id !== "All") {
          const tasks = await Task.find({
            sprint_id,
            "assignees.email": email,
          });
          res.status(200).json({
            message: "Tasks Found",
            tasks,
            log: 9,
            request: req.query,
          });
        }
      } else {
        res.status(404).json({
          message: "Selection invalid",
        });
      }
    }
  } catch (error) {
    res.status(500).json({
      status: 500,
      message: error,
      requested_resource: {
        email: decodeURIComponent(req.query.email),
        sprint_id: decodeURIComponent(req.query.sprint_id),
        authenticating_user: req.user.user,
      },
    });
  }
});

app.delete("/tasks", authenticateJWT, async (req, res) => {
  try {
    const { type, task_ids } = req.body;

    const user = req.user.user;

    if (user) {
      if (type === "one") {
        await Task.findOneAndDelete({ task_id: task_ids[0] });

        res.status(200).json({
          message: "Task Deleted",
          requested_resource: {
            type: "task",
            resource: task_ids,
          },
        });
      } else if (type === "many") {
        await Task.deleteMany({ task_id: { $in: task_ids } });

        res.status(200).json({
          message: "Tasks Deleted",
          requested_resource: {
            type: "task",
            resource: task_ids,
          },
        });
      } else {
        res.status(404).json({
          message: "Please supply an array of task ids",
        });
      }
    } else {
      const client_id = req.user.client_id;

      if (client_id) {
        await Task.findOneAndDelete({
          task_id: { $in: task_ids },
          "client.client_id": client_id,
        });

        res.status(200).json({
          message: "Tasks Deleted",
          requested_resource: {
            type: "task",
            resource: task_ids,
          },
        });
      } else {
        res.status(404).json({
          message: "Authentication Invalid",
        });
      }
    }
  } catch (error) {
    res.status(500).json({ status: 500, message: error });
  }
});

app.get("/user", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const user = req.user.user;

    const existing_user = await User.findOne({ user_id: user.user_id });

    if (existing_user) {
      res.status(200).json({
        message: "User found",
        user: existing_user,
      });
    } else {
      res.status(404).json({
        message: "User not found",
      });
    }
  } catch (error) {
    res.status(500).json({ status: 500, message: error });
  }
});

app.put("/user", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const user = req.user.user;

    const { user_id, name, profile_image_url, email } = req.body;

    if (user_id === user.user_id) {
      if (email) {
        res.status(202).json({
          message:
            "We do not currently support email changes. Check again soon.",
        });
      } else {
        try {
          const updated_user = await User.findOneAndUpdate(
            { user_id },
            {
              $set: { ...req.body },
            },
            {
              new: true,
            }
          );

          res.status(200).json({
            message: "User Updated",
            user: updated_user,
          });
        } catch (error) {
          res.status(500).json({
            message: error,
            attempted_resource: req.body,
            requesting_user: user,
          });
        }
      }
    } else {
      res.status(404).json({
        message: "User does not have access to change user details",
      });
    }
  } catch (error) {
    res.status(500).json({ status: 500, message: error });
  }
});

app.put("/tasks", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { task_id, task } = req.body;

    try {
      const existing_task = await Task.findOne({ task_id });

      if (existing_task) {
        if (
          existing_task.status.status_title !== "Done" &&
          task.status?.status_title === "Done"
        ) {
          try {
            const updated_task = await Task.findOneAndUpdate(
              { task_id },
              {
                $set: {
                  title: task.title,
                  assignees: task.assignees,
                  description: task.description,
                  client: task.client,
                  status: task.status,
                  escalation: task.escalation,
                  completed_on: Date.now(),
                  project: task.project,
                  duration: parseInt(task.duration),
                  // Include any other fields you need to update
                },
              },
              { new: true }
            );

            res.status(200).json({
              message: "Task Updated",
              task: updated_task,
              task_id,
              log: 1,
            });
          } catch (error) {
            res.status(500).json({
              status: 500,
              message: error.message,
              requested_resource: req.body,
            });
          }
        } else if (
          existing_task.status.status_title === "Done" &&
          task.status?.status_title !== "Done"
        ) {
          try {
            const updated_task = await Task.findOneAndUpdate(
              { task_id },
              {
                $set: {
                  title: task.title,
                  assignees: task.assignees,
                  description: task.description,
                  client: task.client,
                  status: task.status,
                  escalation: task.escalation,
                  completed_on: "incomplete",
                  project: task.project,
                  duration: parseInt(task.duration),
                },
              },
              { new: true }
            );

            res.status(200).json({
              message: "Task Updated",
              task: updated_task,
              task_id,
              log: 2,
            });
          } catch (error) {
            res.status(500).json({
              status: 500,
              message: error.message,
              requested_resource: req.body,
            });
          }
        } else {
          try {
            const updated_task = await Task.findOneAndUpdate(
              { task_id },
              {
                $set: {
                  title: task.title,
                  assignees: task.assignees,
                  description: task.description,
                  client: task.client,
                  status: task.status,
                  escalation: task.escalation,
                  project: task.project,
                  duration: parseInt(task.duration),
                },
              },
              { new: true }
            );

            res.status(200).json({
              message: "Task Updated",
              task: updated_task,
              task_id,
              new_duration: parseInt(updated_task.duration),
              old_duration: parseInt(task.duration),
              log: 3,
            });
          } catch (error) {
            res.status(500).json({
              status: 500,
              message: error.message,
              requested_resource: req.body,
            });
          }
        }
      } else {
        res.status(404).json({
          message: "No Task Found",
          requested_resource: req.body,
        });
      }
    } catch (error) {
      res.status(500).json({
        status: 500,
        message: error.message,
        requested_resource: req.body,
      });
    }
  } catch (error) {
    res.status(500).json({
      status: 500,
      message: error.message,
      requested_resource: req.body,
    });
  }
});

app.put("/sprints", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { sprint_id, sprint_data } = req.body;

    const updated_sprint = await Sprint.findOneAndUpdate(
      { sprint_id },
      {
        $set: { sprint_data },
      },
      {
        new: true,
      }
    );

    res.status(200).json({
      message: "Sprint Updated",
      sprint: updated_sprint,
    });
  } catch (error) {
    res.status(500).json({ status: 500, message: error });
  }
});

app.post("/tasks", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    try {
      const {
        title,
        assigned_by,
        assignees,
        description,
        client,
        status,
        escalation,
        start_time,
        duration,
        hard_limit,
        requires_authorization,
        organization,
        temporary_task_id,
        project,
      } = req.body;

      console.log("PAYLOAD DESTRUCTURED");

      const task_id = uuidv4();

      console.log("REQ BODY: ", req.body);

      try {
        const newTask = new Task({
          task_id,
          title,
          assigned_by,
          assignees,
          description: description,
          client,
          status,
          escalation,
          start_time,
          hard_limit,
          duration,
          requires_authorization,
          //sprint_id,
          organization,
          project,
        });

        console.log("NEW TASK: ", newTask);

        try {
          const created_task = await newTask.save();

          console.log("TASK SAVED");

          // await Sprint.findOneAndUpdate(
          //   { sprint_id },
          //   {
          //     $push: { tasks: created_task },
          //   }
          // );

          // if (client) {
          //   await Client.findOneAndUpdate(
          //     { client_id: client.client_id },
          //     {
          //       $push: { tasks: created_task },
          //     }
          //   );
          // }

          console.log("CLIENT UPDATED");

          res.status(200).json({
            message: "Task Created",
            task: created_task,
            temporary_task_id,
          });
        } catch (error) {
          res.status(500).json({
            message: error,
            log: 1,
          });
        }
      } catch (error) {
        res.status(500).json({
          message: error,
          log: 2,
        });
      }
    } catch (error) {
      res.status(500).json({
        message: error,
        log: 3,
      });
    }
  } catch (error) {
    res.status(500).json({ status: 500, message: error, log: 4 });
  }
});

app.get("/projects", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const user_id = req.user.userId;

    let user = await User.find({ user_id });

    const owned_projects = await Project.find({ owner_id: user_id });
    const member_projects = await Project.find({
      members: { $in: [user[0].email] },
    });
    const viewer_projects = await Project.find({
      viewers: { $in: [user[0].email] },
    });

    const projects = [
      ...owned_projects,
      ...member_projects,
      ...viewer_projects,
    ];

    res.status(200).json({
      count: projects.length,
      projects,
    });
  } catch (error) {
    res.status(500).json({ status: 500, message: error });
  }
});

app.post("/client-login", async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const { client_user_email, client_user_password } = req.body;

    const client_user = await ClientUser.findOne({ client_user_email });
    const client = await Client.findOne({
      client_id: client_user.client.client_id,
    });

    if (client_user) {
      const hash_compare = await comparePassword(
        client_user_password,
        client_user.client_user_password
      );

      if (hash_compare) {
        const signed_client_user = jwt.sign(
          {
            client_id: client.client_id,
            client_user_id: client_user.client_user_id,
          },
          process.env.SECRET_JWT,
          {
            expiresIn: "7d",
          }
        );

        res.status(200).json({
          message: "Client Logged In",
          token: signed_client_user,
          client_user,
        });
      } else {
        res.status(409).json({
          message: "Authentication Invalid",
        });
      }
    } else if (client_user.client_user_password !== client_user_password) {
      res.status(404).json({
        message: "Incorrect Login Credentials",
      });
    } else {
      res.status(404).json({
        message: "Could not find client user with the provided credentials",
      });
    }
  } catch (error) {
    res.status(500).json({ status: 500, message: error });
  }
});

app.get("/client-user", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const client_id = req.user.client_id;

    if (client_id) {
      const client_user = await ClientUser.findOne({
        "client.client_id": client_id,
      });

      if (client_user) {
        res.status(200).json({
          message: "Client User Found",
          client_user,
        });
      } else {
        res.status(404).json({
          message: "No Client User Found",
          requested_resource: {
            client_id,
          },
        });
      }
    } else {
      res.status(409).json({
        message: "Authentication Invalid",
      });
    }
  } catch (error) {
    res.status(500).json({ status: 500, message: error });
  }
});

app.post("/client-user", async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);
    console.log("connected");

    const {
      client,
      client_user_name,
      client_user_email,
      client_user_password,
    } = req.body;

    console.log("1", req.body);

    const existing_client = await Client.findOne({
      client_id: client.client_id,
    });

    console.log("2", existing_client);

    if (existing_client.client_users.length < 5) {
      console.log("3");
      const client_user_id = uuidv4();

      const stripe = require("stripe")(process.env.STRIPE_TEST);

      const customer = await stripe.customers.create({
        name: `${client_user_name.first} ${client_user_name.last}`,
        email: client_user_email,
      });

      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(
        client_user_password,
        saltRounds
      );

      const client_user = new ClientUser({
        client_user_id,
        client_user_name,
        client_user_email,
        client_user_password: hashedPassword,
        type: "client user",
        marketable: true,
        client,
        stripe_customer: customer,
      });

      const created_client_user = await client_user.save();

      console.log("4");

      try {
        await Client.findOneAndUpdate(
          { client_id: client.client_id },
          {
            $push: { client_users: client_user },
            client_poc:
              Object.keys(existing_client?.client_poc ?? {}).length === 0
                ? client_user
                : existing_client.client_poc,
          }
        );
      } catch (error) {
        console.error("An error occurred:", error);
        // Handle the error appropriately
      }

      console.log("5");

      const signed_client_user = jwt.sign(
        {
          client_id: existing_client.client_id,
          client_user_id: client_user.client_user_id,
        },
        process.env.SECRET_JWT,
        {
          expiresIn: "7d",
        }
      );

      res.status(200).json({
        message: "Client User Created",
        client_user: created_client_user,
        client,
        token: signed_client_user,
      });
    } else {
      res.status(200).json({
        message: "client has exceeded allowed users",
        client_users: existing_client.client_users,
      });
    }
  } catch (error) {
    res.status(500).json({ status: 500, message: error });
  }
});

app.post("/client", async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);
    const client_id = uuidv4();

    const { client_name, associated_org_id, invitation_id } = req.body;

    const existing_client = await Client.findOne({
      client_name,
      "associated_org.org_id": associated_org_id,
    });

    if (existing_client) {
      res.status(409).message({
        message: "Client already exists. Please log in.",
        client: existing_client,
      });
    } else {
      const organization = await Organization.findOne({
        org_id: associated_org_id,
      });
      if (organization) {
        const new_client = new Client({
          client_id,
          associated_org: organization,
          client_users: [],
          client_poc: {},
          org_poc: organization.billable_user,
          client_name,
          client_admin: {},
          documents: [],
        });

        const created_client = await new_client.save();

        await ClientInvitation.findOneAndUpdate(
          {
            invitation_id,
          },
          {
            status: "accepted",
          }
        );

        await Organization.findOneAndUpdate(
          { org_id: associated_org_id },
          {
            $push: {
              clients: new_client,
            },
          }
        );

        res.status(200).json({
          message: "Client created",
          client: created_client,
        });
      } else {
        res.status(404).json({
          message: `Organization associated with the id of "${associated_org_id}" does not exist`,
        });
      }
    }
  } catch (error) {
    res.status(500).json({ status: 500, message: error });
  }
});

app.get("/client", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const user = req.user.user;
    const organization = user.organization;

    if (user && organization) {
      const clients = await Client.find({
        "associated_org.org_id": organization.org_id,
      });
      const client_invitations = await ClientInvitation.find({
        "associated_org.org_id": organization.org_id,
      });
      res.status(200).json({
        message: "success",
        clients,
        client_invitations,
      });
    } else {
      res.status(500).json({
        message: "something went wrong",
      });
    }
  } catch (error) {
    res.status(500).json({ status: 500, message: error });
  }
});

app.delete("/folder", authenticateJWT, async (req, res) => {
  try {
    await dbConnect(process.env.GEN_AUTH);

    const user = req.user.user; // Ensure this is the correct path to the user object

    const { folder_id } = req.body;

    const folder = await Folder.findOne({ folder_id: folder_id });

    if (folder) {
      if (folder.associated_org.org_id === user.organization.org_id) {
        await Folder.deleteOne({ folder_id: folder_id });
        return res.status(200).json({
          // Add return here
          message: "folder successfully deleted",
        });
      } else {
        // This else block ensures that the 409 response is only sent if the user lacks access
        return res.status(409).json({
          // Add return here
          message: "user does not have access to edit this resource",
        });
      }
    } else {
      return res.status(404).json({
        // Add return here
        message: "no folder with the associated folder id was found",
      });
    }
  } catch (error) {
    console.error("Error deleting folder:", error); // Added error logging for debugging
    return res.status(500).json({
      message: "Error deleting folder",
      error: error.message,
    });
  }
});

app.get("/client-partners", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const client_id = req.user.client_id;

    const partners = await Organization.find({
      "clients.client_id": client_id,
    }).select("members name org_id _id");

    res.status(200).json({
      message: "Partners Found",
      partners,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error auto-saving document",
      error: error.message,
    });
  }
});

app.delete("/document", authenticateJWT, async (req, res) => {
  try {
    await dbConnect(process.env.GEN_AUTH);

    const { document_id } = req.body;
    const user = req.user.user;

    console.log("body", req.body);
    console.log("user", user);

    const document = await Document.findOne({ document_id });

    console.log("document", document);

    if (document) {
      console.log("document found");
      console.log("document org", document.associated_org.org_id);
      console.log("user org", user.organization.org_id);
      if (document.associated_org.org_id === user.organization.org_id) {
        console.log("document passed comparison.. attempting delete");
        await Document.deleteOne({ document_id });
        console.log("successful delete");
        res.status(200).json({
          message: "document deleted",
        });
      } else {
        res.status(409).json({
          message: "user does not have access to this resource",
        });
      }
    } else {
      res.status(404).json({
        message: "no document with the given id was found",
      });
    }
    console.log("nothing happened");
  } catch (error) {
    res.status(500).json({
      message: "Error auto-saving document",
      error: error.message,
    });
  }
});

app.post("/autosave-document", authenticateJWT, async (req, res) => {
  try {
    await dbConnect(process.env.GEN_AUTH);

    const {
      document_id,
      document_data,
      document_client,
      document_folder,
      temporary_id,
    } = req.body;
    const user = req.user;

    if (document_id) {
      const document = await Document.findOne({ document_id });
      if (document) {
        const updated_document = await Document.findOneAndUpdate(
          {
            document_id,
          },
          {
            $set: { ...document_data, document_id, document_client },
          },
          {
            new: true,
          }
        );

        res.status(200).json({
          message: "document saved",
          document: {
            title: updated_document.title,
            document_id: updated_document.document_id,
            is_public: updated_document.is_public,
            document_client: updated_document.document_client,
            document_folder: updated_document.document_folder,
            contributors: updated_document.contributors,
          },
          status: "old",
        });
      }
    } else {
      const newDocument = new Document({
        document_id: uuidv4(), // Generate a new UUID for the document
        associated_org: document_data.associated_org,
        contributors: document_data.contributors,
        document_client: document_client || {},
        updates: document_data.updates,
        document_folder: document_folder || {},
        creator: user.user, // Assuming user object has a nested user object
        content: document_data.content,
        blocks: document_data.blocks,
        last_block_timestamp: document_data.last_block_timestamp,
        last_block_version: document_data.last_block_version,
        title: document_data.title,
        created_timestamp: Date.now(),
        is_public: document_data.is_public,
      });

      console.log("temporary id", temporary_id);

      const savedDocument = await newDocument.save();
      res.status(200).json({
        message: "document saved",
        document: {
          title: newDocument.title,
          document_id: newDocument.document_id,
          is_public: newDocument.is_public,
          document_client: newDocument.document_client,
          document_folder: newDocument.document_folder,
          contributors: newDocument.contributors,
        },
        temporary_id: `${temporary_id ? temporary_id : ""}`,
        status: "new",
      });
    }
  } catch (error) {
    console.error("Error auto-saving document", error);
    res.status(500).json({
      message: "Error auto-saving document",
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
