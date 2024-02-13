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
app.use(express.json());

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
        redirect: { url: "kamariteams.com" },
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
      const task_id = uuidv4();
      const alert_id = uuidv4();
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
      });

      const org_user = {
        user_id,
        email,
        name: {
          first: first,
          last: last,
        },
        type,
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

      // create first task
      const firstTask = new Task({
        task_id,
        title: "Getting Started",
        assigned_by: {
          email: "danielfcarmichael@gmail.com",
        },
        description: "Get acquainted with the app",
        assignees: [newUser.email],
        status: { status_title: "Backlog" },
        escalation: {
          title: "Low",
          color: "#2EC4B6",
          softerColor: "rgba(46, 196, 182, 0.3)", // Softer color with reduced opacity
        },
        start_time: Date.now(),
        duration: 5,
        hard_limit: false,
        requires_authorization: false,
        sprint_id,
      });

      const newSprint = new Sprint({
        sprint_id,
        title: `${first}'s First Sprint`,
        owner: newUser,
        members: [newUser],
        objective: "Scale your documentation and business",
        viewers: [],
        status: {
          time_allocated: 0,
          time_over: 0,
          active_status: "Not Started",
        },
        start_date_time: Date.now(),
        duration: "1209600000",
        kpi_data: {},
        organization: newOrg,
        is_started: false,
        tasks: [first_task],
      });

      const newProject = new Project({
        project_id,
        title: `${newOrg.name}'s First Project`,
        tasks: [firstTask],
        owner: newUser,
        owner_id: user_id,
        members: [],
        viewers: [],
        status: {
          task_percentage_complete: 0,
          status: "Active",
          percentage_backlogged: 0,
        },
        start_date_time: Date.now(),
        end_date_time: new Date(
          new Date().setDate(new Date().getDate() + 7)
        ).getTime(),
        kpi_data: {},
        cost: {},
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

      const created_org = await newOrg.save();

      // save new user and the new group made for the user
      newUser.organization = created_org;
      const created_user = await newUser.save();

      const created_task = await firstTask.save();

      const created_project = await newProject.save();

      console.log(created_project);

      await newSprint.save();

      await User.findOneAndUpdate(
        { user_id },
        {
          $push: { tasks: created_task },
        }
      ).then(async (res) => {
        await newAlert.save();
      });

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

app.get("/organization", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const user = req.user.user;

    const organization = await Organization.findOne({
      org_id: user.organization.org_id,
    });

    if (organization) {
      res.status(200).json({
        message: "Organization Found",
        organization,
      });
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

app.get("/documents", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    // Assuming req.user.organization holds the user's organization details
    const org_id = req.user.user.organization.org_id;

    // Use the org_id to find documents
    const documents = await Document.find({ "associated_org.org_id": org_id });

    // Send the documents as a response
    res.status(200).json({
      count: documents.length,
      documents,
    });
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

    console.log("xx123xx_client", client);
    console.log("xx123xx_name", name);
    console.log("xx123xx_documents", documents);
    console.log("xx123xx_description", description);
    console.log("xx123xx_organization", user.organization);

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
    const { client_email } = req.body;

    console.log(client_email, invitation_id, associated_org);

    const newClientInvitation = new ClientInvitation({
      invitation_id,
      associated_org,
      status: "unaccepted",
      client_email,
      invite_url: `https://kamariteams.com/client-signup?email=${client_email}&type=client&org_id=${associated_org.org_id}&invitation_id=${invitation_id}`,
    });

    const created_client_invitation = await newClientInvitation.save();

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

    const { email } = req.body;

    // add authenticating user correlation check
    const authenticating_user = req.user.user;

    if (email) {
      if (email === "all") {
        const active_sprint = await Sprint.findOne({ status: "Active" });

        const tasks = await Task.find({ sprint_id: active_sprint.sprint_id });

        res.status(200).json({
          status: 200,
          tasks,
        });
      } else {
        const tasks = await Task.find({ assignees: { $in: [email] } });
        res.status(200).json({
          status: 200,
          tasks,
        });
      }
    } else {
      const tasks = await Task.find({
        assignees: { $in: [authenticating_user.email] },
      });
      res.status(200).json({
        status: 200,
        tasks,
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
        res
          .status(202)
          .json({
            message:
              "We do not currently support email changes. Check again soon.",
          });
      }
      else {
        try {
          const updated_user = await User.findOneAndUpdate({ user_id }, {
            $set: { ...payload }
          }, {
            new: true
          })
  
          res.status(200).json({
            message: "User Updated",
            user: updated_user
          })
        } catch (error) {
          res.status(500).json({
            message: error,
            attempted_resource: req.body
          })
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

app.post("/tasks", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

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
      sprint_id,
      organization,
      temporary_task_id,
    } = req.body;

    const task_id = uuidv4();

    const newTask = new Task({
      task_id,
      title,
      assigned_by,
      assignees,
      description: description || "",
      client: client || {},
      status,
      escalation,
      start_time,
      hard_limit,
      duration,
      requires_authorization,
      sprint_id,
      organization,
    });

    const created_task = await newTask.save();

    await Sprint.findOneAndUpdate(
      { sprint_id },
      {
        $push: { tasks: created_task },
      }
    );

    if (client) {
      await Client.findOneAndUpdate(
        { client_id: client.client_id },
        {
          $push: { tasks: created_task },
        }
      );
    }

    created_task.temporary_task_id = temporary_task_id;

    res.status(200).json({
      message: "Task Created",
      task: created_task,
    });
  } catch (error) {
    res.status(500).json({ status: 500, message: error });
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
      const client_user = new ClientUser({
        client_user_id,
        client_user_name,
        client_user_email,
        client_user_password,
        type: "client user",
        marketable: true,
        client,
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

      res.status(200).json({
        message: "Client User Created",
        client_user: created_client_user,
        client,
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
            $set: { ...document_data, document_id },
          },
          {
            new: true,
          }
        );

        res.status(200).json({
          document: updated_document,
          status: "old",
        });
      }
    } else {
      const newDocument = new Document({
        document_id: uuidv4(), // Generate a new UUID for the document
        associated_org: document_data.associated_org,
        contributors: document_data.contributors,
        document_client: document_client,
        updates: document_data.updates,
        document_folder: document_folder,
        creator: user.user, // Assuming user object has a nested user object
        content: document_data.content,
        blocks: document_data.blocks,
        last_block_timestamp: document_data.last_block_timestamp,
        last_block_version: document_data.last_block_version,
        title: document_data.title,
        created_timestamp: Date.now(),
      });

      console.log("temporary id", temporary_id);

      const savedDocument = await newDocument.save();
      res.status(200).json({
        message: "document saved",
        document: savedDocument,
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
