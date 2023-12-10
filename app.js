const express = require("express");
const cors = require("cors");
const dbConnect = require("./src/utils/dbConnect");
const { v4: uuidv4 } = require("uuid");
const Jam = require("./src/models/jam");

const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.options("*", cors()); // Enable CORS pre-flight request for all routes
app.use(express.json());

app.get("/", (req, res) => {
  console.log("received home");
  return res.status(200).json({ message: "working" });
});

// this endpoint uses the "auth" auth
app.post("/create_jam", async (req, res) => {
  dbConnect(process.env.GEN_AUTH);

  const { title, time_limit, jam_url, options = {} } = req.body;
  const jam_id = uuidv4();
  console.log("yes");
  const new_jam = new Jam({
    title,
    time_limit,
    created_timestamp: Date.now(),
    jam_url,
    options,
    _id: jam_id,
  });

  await new_jam.save();
  res.status(200).json({ message: "Jam Created" });
});

// // this endpoint uses the user management auth
// app.get("/get_jam", async (req, res) => {
//   try {
//     await dbConnect(process.env.GEN_AUTH);
//   } catch (error) {
//     res.status(400).json({ message: error.message });
//   }
// });

// // this endpoint uses the user management auth
// app.post("/update_jam", async (req, res) => {
//   const { email, full_name, configs, payment, associated_id } = req.body; // req.body, not req

//   try {
//     await dbConnect(process.env.GEN_AUTH).then((res) => {
//       console.log("connection console log ", res);
//     });

//     // findOne returns a query, you need to execute it to get the data
//     console.log("attempting to find existing config");
//     const existing_config = await User_Config.findOne({ email });
//     console.log("config search complete");
//     console.log("existing config: ", existing_config);

//     if (existing_config) {
//       // Update the existing document
//       existing_config.full_name = full_name;
//       existing_config.configs = configs;
//       existing_config.payment = payment;
//       await existing_config.save();
//       res.status(200).json({ message: "user config updated" });
//     } else {
//       // Create new document
//       const user_config = new User_Config({
//         email,
//         full_name,
//         configs,
//         payment,
//         associated_id,
//       });
//       await user_config.save();
//       res.status(201).json({ message: "user config saved" });
//     }
//   } catch (error) {
//     console.log("there was an error creating the authentication");
//     res.status(500).json({ message: error.message });
//   }
// });

// // this endpoint uses the base auth
// app.post("/delete_jam", async (req, res) => {
//   console.log("Received signup", req.body); // Log incoming request
//   const { email, password, full_name } = req.body;
//   const user_id = uuidv4();

//   console.log("##############################");
//   console.log("Attempting to sign up user");
//   console.log("##############################");

//   try {
//     await dbConnect(process.env.GEN_AUTH).then((res) => {
//       console.log("database connection established");
//     });
//     console.log("##############################");
//     console.log("Connected to DB");
//     console.log("##############################");

//     const existing_user = await User.findOne({ email });

//     console.log("##############################");
//     console.log("Search for user completed");
//     console.log("##############################");

//     if (existing_user) {
//       res.status(204).json({ message: "user already exists" });
//     } else {
//       const user = new User({
//         email,
//         password,
//         full_name,
//         associated_id: user_id,
//       });
//       await user.save();

//       console.log("##############################");
//       console.log("User saved");
//       console.log("##############################");

//       res.status(201).json({ message: "User registered" });

//       try {
//         // await utility(user);
//         // connect to config auth and force a reconnect
//         await dbConnect(process.env.GEN_AUTH);

//         console.log("##############################");
//         console.log("New DB connection succeeded");
//         console.log("##############################");

//         console.log("user config start")
//         // search configs for existing config by user associated_id
//         const existing_config = await User_Config.findOne({ associated_id: user_id });
//         console.log("user config finish")

//         console.log("##############################");
//         console.log("Search for existing config completed");
//         console.log("##############################");

//         if (!existing_config) {
//           // Create new config document
//           const user_config = new User_Config({
//             email,
//             full_name,
//             configs: {},
//             payment: {
//               status: "trial",
//               plan_start_date: "",
//               plan_end_date: "",
//               invoice_id: "",
//               stripe_customer_id: "",
//               period: "monthly",
//               plan_id: "trial",
//               discount_code: "",
//               usage: {
//                 period_start: "",
//                 period_end: "",
//                 usage: 1,
//               },
//             },
//             associated_id: user_id,
//           });

//           await user_config.save();

//           console.log("##############################");
//           console.log("User config saved");
//           console.log("##############################");
//         } else {
//           // Update the existing document
//           existing_config.full_name = full_name;
//           existing_config.configs = configs;
//           existing_config.payment = payment;
//           await existing_config.save();
//         }
//       } catch (error) {
//         console.log("couldn't save configs");
//       }
//     }
//   } catch (error) {
//     console.error("Signup failed:", error);
//     res.status(500).json({ message: "Internal Server Error" });
//   }
// });
