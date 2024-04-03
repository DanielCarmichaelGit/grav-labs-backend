const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const path = require("path");
const fs = require("fs");

// import utility functions
const dbConnect = require("./src/utils/dbConnect");
const { Anthropic } = require("@anthropic-ai/sdk");

const multer = require("multer");

// import packages
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const sgTransport = require("nodemailer-sendgrid-transport");
const bcrypt = require("bcrypt");

const User = require("./src/models/user");
const LandingPage = require("./src/models/landingPage");
const PageHistory = require("./src/models/pageHistory");
const MessageThread = require("./src/models/threads");
const Image = require("./src/models/image");
const Variant = require("./src/models/variant");

// Secret key for JWT signing (change it to a strong, random value)
const SECRET_JWT = process.env.SECRET_JWT;

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.use(cors());
app.options("*", cors());
app.use(express.json({ limit: "50mb" }));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

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

function removeEscapeCharacters(str) {
  return str.replace(/\t|\n/g, "");
}

// test endpoint to verify server status
app.get("/", (req, res) => {
  console.log("received home");
  return res.status(200).json({ message: "working", status: 200 });
});

app.get("/user", authenticateJWT, async (req, res) => {
  try {
    const user_id = req.user.user.user_id;

    if (user_id) {
      await dbConnect(process.env.GEN_AUTH);

      const existing_user = await User.findOne({ user_id });

      if (existing_user) {
        res.status(200).json({
          message: "user found",
          status: 200,
          user: existing_user,
        });
      } else {
        res.status(404).json({
          message: "no user found",
          status: 404,
        });
      }
    } else {
      res.status(409).json({
        message: "authentication invalid",
      });
    }
  } catch (error) {
    console.error("Error during user fetch:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
});

app.put("/user", authenticateJWT, async (req, res) => {
  try {
    dbConnect(process.env.GEN_AUTH);

    const user = req.user.user;

    const { user_id, email } = req.body;

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

app.post("/signup", async (req, res) => {
  try {
    await dbConnect(process.env.GEN_AUTH);
    const { password, email, name } = req.body;
    console.log(name);

    const { first, last } = name;

    // Check if the username already exists
    const existingUser = await User.findOne({ email });

    // if existing user, early return
    if (existingUser) {
      return res.status(409).json({
        message: "Username already exists",
        redirect: { url: "https://kamariteams.com" },
      });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const user_id = uuidv4();

    //Create a jam group for this new user
    const newUser = new User({
      user_id,
      email,
      password: hashedPassword,
      name: {
        first,
        last,
      },
    });

    const created_user = await newUser.save();

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
      token,
    });
  } catch (error) {
    console.error("Error during user registration:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
});

app.post("/login", async (req, res) => {
  try {
    await dbConnect(process.env.GEN_AUTH);

    const { email, password } = req.body;

    const existing_user = await User.findOne({ email });

    if (!existing_user) {
      res.status(500).json({ message: "User not found" });
      console.log("user not found");
    } else {
      console.log("starting hash compare");
      const hash_compare = await comparePassword(
        password,
        existing_user.password
      );

      if (hash_compare) {
        console.log("hash compare true");

        const signed_user = jwt.sign(
          { user: existing_user, userId: existing_user.user_id },
          process.env.SECRET_JWT,
          {
            expiresIn: "7d",
          }
        );

        const result = {
          user: existing_user,
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

app.post("/upload-image", authenticateJWT, (req, res) => {
  const { copy = "" } = req.body;

  upload.single("image")(req, res, async (err) => {
    console.log("Received request");
    console.log("Uploaded file:", req.file);

    if (err instanceof multer.MulterError) {
      // Handle multer errors
      console.error("Multer error:", err);
      return res.status(400).json({ error: "File upload error", extra: err });
    } else if (err) {
      // Handle other errors
      console.error("Error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }

    try {
      if (!req.user || !req.user.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Establish a database connection
      await dbConnect(process.env.GEN_AUTH);

      const image = req.file;
      if (!image) {
        return res.status(400).json({ error: "No image file provided" });
      }

      const uniqueFilename = `${Date.now()}-${image.originalname
        .split(" ")
        .join("-")}`;
      const uploadDirectory = path.join(__dirname, "public", "uploads");

      // Create the upload directory if it doesn't exist
      if (!fs.existsSync(uploadDirectory)) {
        fs.mkdirSync(uploadDirectory);
      }

      // Save the image file to the upload directory
      const imagePath = path.join(uploadDirectory, uniqueFilename);
      fs.writeFileSync(imagePath, image.buffer);

      // Generate the hosted URL for the image
      const hostedUrl = `${req.protocol}://${req.get(
        "host"
      )}/uploads/${uniqueFilename}`;

      // Save the image metadata to MongoDB
      const image_id = uuidv4();
      const newImage = new Image({
        image_id,
        filename: uniqueFilename,
        contentType: image.mimetype,
        user_id: req.user.user.user_id,
        hosted_url: hostedUrl,
        copy,
      });
      const created_image = await newImage.save();

      res.status(200).json({
        message: "Image uploaded successfully",
        imageUrl: hostedUrl,
        image: created_image,
      });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ error: "An error occurred" });
    }
  });
});

app.post("/anthropic/modify-html/stream", authenticateJWT, async (req, res) => {
  const { prompt, html, initialPrompt, history_id, page_id } = req.body;

  try {
    let messages = [];
    dbConnect(process.env.GEN_AUTH);

    if (history_id) {
      console.log("Finding Threads", history_id.split(" "));
      const threads = await MessageThread.findOne({ history_id });
      if (threads.length > 0) {
        messages = threads;
      } else {
        messages = [
          { role: "user", content: JSON.stringify(initialPrompt) },
          { role: "assistant", content: JSON.stringify(html) },
          { role: "user", content: JSON.stringify(prompt) },
        ];
      }
    } else {
      messages = [
        { role: "user", content: JSON.stringify(initialPrompt) },
        { role: "assistant", content: JSON.stringify(html) },
        { role: "user", content: JSON.stringify(prompt) },
      ];
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const streamResponse = async () => {
      const stream = await anthropic.messages.stream({
        system:
          '<instructions>\nYour task is to intake a json object and output a customized landing page written in HTML. The output should start with <!DOCTYPE html> and end with </html>. Ensure that the design is visually appealing, responsive, and user-friendly. The HTML, CSS, and JavaScript code should be well-structured, efficiently organized, and properly commented for readability and maintainability.\n\nSometimes the input will just be a simple string and not an object. If it is a string, make the changes requested in the string to the existing webpage and no other alterations. Then, output the updated webpage peer the output specifications.\n</instructions>\n\n<rules>\nThe generated HTML Page should always use normalize css as the base stylesheet which can be imported into the landing page using the below element:\n\n<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/normalize/8.0.1/normalize.min.css">\n\nNo content should horizontally overflow on the edges of the screen. If content is to overflow on the x plane, it needs to wrap.Overflow vertical content is acceptable.\n\nImages may be provided, if specified in the users prompt - apply the image where specified, otherwise analyze the image and place the image on the webpage somewhere and attach some relevant copy.\n\nThere must be a header, main section with all the content, and a footer. The header must have a left aligned logo image or logo text and right aligned buttons. The header should be no more than 75px in height. If the user requests the header to be styled differently, you must make the header style changes.\n</rules>\n\n<example inputs>\n<example input 1>\n{\n    "website_title": "Mortecai",\n    "theme": "dark",\n    "colors": {\n        "primary": "#9013fe",\n        "secondary": "#bd10e0",\n        "tertiary": "#ff5367"\n    },\n    "industry": "Generative AI, AI Web Development, AI, No Code",\n    "copy": "Mortecai is a generative ai solution that uses existing ai infrastructure, internal model training and alignment, and high quality source code to generate full stack web applications based on just a few prompts. The typical cost of building an mvp of a web app for a non technical founder is between $10k and $50k. Using Mortecai, we can reduce that cost by a factor of 10.\\n\\nOur beta now offers landing page generation and hosting. Please be prepared as we acquire funcing soon and launch mortecai into the starts. \\n\\nOur mission is to bring a software engineer into everyone\'s business. No technical skills required.. at all.. ever.. yeah..",\n    "staggered": true,\n    "alignment": "left"\n}\n</example input 1>\n<example input 2>\n{\n    "website_title": "Lavendar",\n    "theme": "light",\n    "colors": {\n        "primary": "#9013fe",\n        "secondary": "#bd10e0",\n        "tertiary": "#ff5367"\n    },\n    "industry": "Flower Growing, Florist, Flower Potting and Planting",\n    "copy": "Lavender is the premier florist for weddings, events, and birthdays in New York City. We bring you earth raised flowers still fresh with the aromas of mother earth. we offer florist catering and event setups as well as bouquets for purchase at one of our many retail centers in the city",\n    "staggered": false,\n    "alignment": "center"\n}\n</example input 2>\n<example input 3>\nadd a free use image for the logo from undraw -- RAG Resource Images: \n</example input 3>\n</example inputs>\n\n\n<reference landing page screenshots>\n</reference landing page screenshots>\n\n',
        messages: [...messages],
        model: "claude-3-sonnet-20240229",
        max_tokens: 4000,
      });

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      let result = "";
      let isFirstChunk = true;

      stream.on("text", (text) => {
        if (isFirstChunk) {
          if (text.trim().charAt(0) !== "<") {
            stream.cancel();
            streamResponse(); // Retry the request
            return;
          }
          isFirstChunk = false;
        }

        result += removeEscapeCharacters(text);
        res.write(removeEscapeCharacters(text));
      });

      stream.on("end", async () => {
        let this_history_id = history_id?.length > 0 ? history_id : uuidv4();

        const newVariant = new Variant({
          variant_id: uuidv4(),
          user_id: req.user.user.user_id,
          page_id,
          timestamp: Date.now(),
          content: result,
          messages: [
            ...messages,
            { role: "user", content: JSON.stringify(prompt) },
            { role: "assistant", content: result },
          ],
        });

        await PageHistory.findOneAndUpdate(
          { page_id },
          {
            $set: {
              history_id: this_history_id,
              timestamp: Date.now(),
              content: result,
            },
            $inc: {
              variant_count: 1,
            },
          }
        );

        newVariant.save();

        await MessageThread.findOneAndUpdate(
          { history_id: this_history_id },
          {
            $push: {
              messages: [
                { role: "user", content: JSON.stringify(prompt) },
                { role: "assistant", content: result },
              ],
            },
          }
        );

        res.end();
      });

      stream.on("error", (error) => {
        console.error("Error:", error);
        res.status(500).end("An error occurred");
      });
    };

    streamResponse();
  } catch (error) {
    console.error("Error:", error);
    res.status(500).end("An error occurred");
  }
});

// Endpoint to serve uploaded images
app.get("/uploads/:filename", (req, res) => {
  const filename = req.params.filename;
  const imagePath = path.join(__dirname, "public", "uploads", filename);

  // Check if the image file exists
  if (fs.existsSync(imagePath)) {
    res.sendFile(imagePath);
  } else {
    res.status(404).json({ error: "Image not found" });
  }
});

app.get("/images", authenticateJWT, async (req, res) => {
  try {
    const user_id = req.user.user.user_id;

    if (user_id) {
      await dbConnect(process.env.GEN_AUTH);

      const images = await Image.find({ user_id });

      if (images) {
        res.status(200).json({
          message: "images found",
          status: 200,
          count: images.length,
          images,
        });
      } else {
        res.status(404).json({
          message: "no images found",
          status: 404,
        });
      }
    } else {
      res.status(409).json({
        message: "authentication invalid",
        status: 409,
      });
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).end("An error occurred");
  }
});

app.post(
  "/anthropic/landing-page/stream",
  authenticateJWT,
  async (req, res) => {
    const { prompt } = req.body;

    try {
      const page_id = uuidv4();
      const history_id = uuidv4();
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      const stream = await anthropic.messages.stream({
        system:
          '<instructions>\nYour task is to intake a json object and output a customized landing page written in HTML. The output should start with <!DOCTYPE html> and end with </html>. Ensure that the design is visually appealing, responsive, and user-friendly. The HTML, CSS, and JavaScript code should be well-structured, efficiently organized, and properly commented for readability and maintainability.\n\nSometimes the input will just be a simple string and not an object. If it is a string, make the changes requested in the string to the existing webpage and no other alterations. Then, output the updated webpage peer the output specifications.\n</instructions>\n\n<rules>\nThe generated HTML Page should always use normalize css as the base stylesheet which can be imported into the landing page using the below element:\n\n<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/normalize/8.0.1/normalize.min.css">\n\nNo content should horizontally overflow on the edges of the screen. If content is to overflow on the x plane, it needs to wrap.Overflow vertical content is acceptable.\n\nImages may be provided, if specified in the users prompt - apply the image where specified, otherwise analyze the image and place the image on the webpage somewhere and attach some relevant copy.\n\nThere must be a header, main section with all the content, and a footer. The header must have a left aligned logo image or logo text and right aligned buttons. The header should be no more than 75px in height. If the user requests the header to be styled differently, you must make the header style changes.\n</rules>\n\n<example inputs>\n<example input 1>\n{\n    "website_title": "Mortecai",\n    "theme": "dark",\n    "colors": {\n        "primary": "#9013fe",\n        "secondary": "#bd10e0",\n        "tertiary": "#ff5367"\n    },\n    "industry": "Generative AI, AI Web Development, AI, No Code",\n    "copy": "Mortecai is a generative ai solution that uses existing ai infrastructure, internal model training and alignment, and high quality source code to generate full stack web applications based on just a few prompts. The typical cost of building an mvp of a web app for a non technical founder is between $10k and $50k. Using Mortecai, we can reduce that cost by a factor of 10.\\n\\nOur beta now offers landing page generation and hosting. Please be prepared as we acquire funcing soon and launch mortecai into the starts. \\n\\nOur mission is to bring a software engineer into everyone\'s business. No technical skills required.. at all.. ever.. yeah..",\n    "staggered": true,\n    "alignment": "left"\n}\n</example input 1>\n<example input 2>\n{\n    "website_title": "Lavendar",\n    "theme": "light",\n    "colors": {\n        "primary": "#9013fe",\n        "secondary": "#bd10e0",\n        "tertiary": "#ff5367"\n    },\n    "industry": "Flower Growing, Florist, Flower Potting and Planting",\n    "copy": "Lavender is the premier florist for weddings, events, and birthdays in New York City. We bring you earth raised flowers still fresh with the aromas of mother earth. we offer florist catering and event setups as well as bouquets for purchase at one of our many retail centers in the city",\n    "staggered": false,\n    "alignment": "center"\n}\n</example input 2>\n<example input 3>\nadd a free use image for the logo from undraw -- RAG Resource Images: \n</example input 3>\n</example inputs>\n\n\n<reference landing page screenshots>\n</reference landing page screenshots>\n\n',
        messages: [
          {
            role: "user",
            content: JSON.stringify(prompt),
          },
        ],
        model: "claude-3-sonnet-20240229",
        max_tokens: 4000,
      });

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      let result = "";

      stream.on("text", (text) => {
        result += removeEscapeCharacters(text);
        res.write(removeEscapeCharacters(text));
      });

      stream.on("end", () => {
        const newPage = new LandingPage({
          page_id,
          content: result,
          timestamp: Date.now(),
          history_id,
          user_id: req.user.user.user_id,
        });

        const newHistory = new PageHistory({
          history_id,
          content: result,
          timestamp: Date.now(),
          page_id,
          user_id: req.user.user.user_id,
          variant_count: 1,
        });

        const newVariant = new Variant({
          variant_id: uuidv4(),
          user_id: req.user.user.user_id,
          page_id,
          timestamp: Date.now(),
          content: result,
          messages: [
            { role: "user", content: JSON.stringify(prompt) },
            { role: "assistant", content: result },
          ],
        });

        const newThread = new MessageThread({
          history_id,
          user_id: req.user.user.user_id,
          page_id,
          messages: [
            { role: "user", content: JSON.stringify(prompt) },
            { role: "assistant", content: result },
          ],
        });

        dbConnect(process.env.GEN_AUTH);

        newPage.save();
        newHistory.save();
        newThread.save();
        newVariant.save();

        res.write(`data:${JSON.stringify({ history_id, page_id })}`); // Send history_id as a separate event
        res.end();
      });

      stream.on("error", (error) => {
        console.error("Error:", error);
        res.status(500).json({ error: "An error occurred" });
      });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ error: "An error occurred" });
    }
  }
);

app.get("/history", authenticateJWT, async (req, res) => {
  try {
    const { history_id } = req.body;

    if (history_id) {
      dbConnect(process.env.GEN_AUTH);

      const versions = LandingPage.find({ history_id });

      if (versions?.length > 0) {
        res.status(200).json({
          message: "Versions Found",
          count: versions.length,
          versions,
        });
      } else {
        res.status(404).json({
          message: "No versions found",
          count: 0,
        });
      }
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "An error occurred" });
  }
});

app.get("/variants", authenticateJWT, async (req, res) => {
  try {
    const { history_id } = req.body;

    if (history_id) {
      dbConnect(process.env.GEN_AUTH);

      const versions = LandingPage.find({ history_id });

      if (versions?.length > 0) {
        res.status(200).json({
          message: "Versions Found",
          count: versions.length,
          versions,
        });
      } else {
        res.status(404).json({
          message: "No versions found",
          count: 0,
        });
      }
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "An error occurred" });
  }
});

app.get("/threads", authenticateJWT, async (req, res) => {
  try {
    const user_id = req.user.user.user_id;

    if (user_id) {
      dbConnect(process.env.GEN_AUTH);

      const threads = await MessageThread.find({ user_id });

      res.status(200).json({
        message: "threads found",
        count: threads.length,
        threads,
      });
    } else {
      res.status(404).json({
        message: "No user found",
      });
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "An error occurred" });
  }
});

app.get("/pages", authenticateJWT, async (req, res) => {
  try {
    const user_id = req.user.user.user_id;

    if (user_id) {
      dbConnect(process.env.GEN_AUTH);

      const pages = await PageHistory.find({ user_id }).select(
        "timestamp content history_id page_id"
      );

      res.status(200).json({
        message: "pages found",
        count: pages.length,
        pages,
      });
    } else {
      res.status(404).json({
        message: "No user found",
      });
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "An error occurred" });
  }
});

app.get("/page", authenticateJWT, async (req, res) => {
  try {
    const { page_id } = req.body;

    if (page_id) {
      dbConnect(process.env.GEN_AUTH);

      const landing_page = LandingPage.findOne({ page_id });

      if (landing_page) {
        res.status(200).json({
          message: "Landing page found",
          landing_page,
        });
      } else {
        res.status(404).json({
          message: "No landing page found",
        });
      }
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "An error occurred" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
