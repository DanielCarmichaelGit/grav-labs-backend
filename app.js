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
const { HfInference } = require("@huggingface/inference");

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

app.post("/anthropic/clean-html", authenticateJWT, async (req, res) => {
  try {
    const { page_id, variant_id, code } = req.body;
    if (page_id && variant_id) {
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      const cleaned_code = await anthropic.messages.create({
        model: "claude-3-sonnet-20240229",
        system:
          "Your role is to intake a string that contains an entire html page and output a cleaned string that is the html page.\n\nThe issue is that sometimes I get a an html page with fluff text, random quotation marks, and random escape sequences scattered throughout the page. Sometimes, the html also contains fluff that falls outside the html page. Do not ever return any response that starts with something like 'here are the changes you asked for' as it breaks the output.",
        max_tokens: 4000,
        messages: [{ role: "user", content: code }],
      });
      if (cleaned_code.content[0].text) {
        await Variant.findOneAndUpdate(
          { variant_id },
          { $set: { content: cleaned_code.content[0].text } }
        );
        await PageHistory.findOneAndUpdate(
          { page_id: page_id },
          { $set: { content: cleaned_code.content[0].text } }
        );
        res.status(200).json({
          content: cleaned_code.content[0].text,
          message: "HTML Cleaned",
        });
      } else {
        res.status(500).json({ message: "could not clean code" });
      }
    } else {
      res.status(404).json({ message: "please provide a page and variant id" });
    }
  } catch (error) {
    console.error("Error during html cleaning:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
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

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

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
          '<instructions>\nYour task is to intake a json object and output a customized landing page written in HTML. Ensure that the design is visually appealing, responsive, and user-friendly. The HTML, CSS, and JavaScript code should be well-structured, efficiently organized, and properly commented for readability and maintainability. Ensure the output complies with the output specifications.\n\nSometimes the input will just be a simple string and not an object. If it is a string, make the changes requested in the string to the existing webpage and no other alterations. Then, output the updated webpage per the output specifications.\n</instructions>\n\n<Output Specifications>\nThe output should start with <!DOCTYPE html> and end with </html>.\n\nThe output should have and html header at the top of the page, main content, and a footer at the bottom of the page. The page should be a height of at least 100vh. \n\nThe output page should be SEO optimized.\n\nThe output page should be at no more than 3000px long and should have plenty of copy derived from provided brand industry and brand copy that fills the page. Add call to actions where necessary.\n\nInclude page animations and scroll animations for page content.\n</Output Specifications>\n\n<Rules>\n<Rule 1>\nThe generated HTML Page should always use normalize css as the base stylesheet which can be imported into the landing page using the below element:\n\n<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/normalize/8.0.1/normalize.min.css">\n</Rule 1>\n\n<Rule 2>\nNo content should horizontally overflow on the edges of the screen. If content is to overflow on the x plane, it needs to wrap.Overflow vertical content is acceptable.\n</Rule 2>\n\n<Rule 3>\nImages may be provided, if specified in the users prompt - apply the image where specified, otherwise analyze the image and place the image on the webpage somewhere and attach some relevant copy.\n</Rule 3>\n\n<Rule 4>\nThere must be a header, main section with all the content, and a footer. The header must have a left aligned logo image or logo text and right aligned buttons. The header should be no more than 60px in height. If the user requests the header to be styled differently, you must make the header style changes.\n</Rule 4>\n\n<Rule 5>\nWhen generating HTML and CSS for landing pages, make sure to include the following CSS rule to ensure the main content stretches to fill the remaining vertical space and the footer always stays at the bottom of the page:\n\ncss:\nbody {\n  display: flex;\n  flex-direction: column;\n  min-height: 400vh;\n}\n\nmain {\n  flex: 1;\n}\n</Rule 5>\n\n<Rule 6>\nThe min height of the body is 400vh. The entire height should be full of content including relevant industry information, brand copy, and images. If not enough copy is provided, derive copy from brand industry, brand_copy, and other relevant resources.\n</Rule 6>\n</Rules>\n\n<example inputs>\n<example input 1>\n{\n    "website_title": "Mortecai",\n    "theme": "dark",\n    "colors": {\n        "primary": "#9013fe",\n        "secondary": "#bd10e0",\n        "tertiary": "#ff5367"\n    },\n    "industry": "Generative AI, AI Web Development, AI, No Code",\n    "copy": "Mortecai is a generative ai solution that uses existing ai infrastructure, internal model training and alignment, and high quality source code to generate full stack web applications based on just a few prompts. The typical cost of building an mvp of a web app for a non technical founder is between $10k and $50k. Using Mortecai, we can reduce that cost by a factor of 10.\\n\\nOur beta now offers landing page generation and hosting. Please be prepared as we acquire funcing soon and launch mortecai into the starts. \\n\\nOur mission is to bring a software engineer into everyone\'s business. No technical skills required.. at all.. ever.. yeah..",\n    "staggered": true,\n    "alignment": "left"\n}\n</example input 1>\n<example input 2>\n{\n    "website_title": "Lavendar",\n    "theme": "light",\n    "colors": {\n        "primary": "#9013fe",\n        "secondary": "#bd10e0",\n        "tertiary": "#ff5367"\n    },\n    "industry": "Flower Growing, Florist, Flower Potting and Planting",\n    "copy": "Lavender is the premier florist for weddings, events, and birthdays in New York City. We bring you earth raised flowers still fresh with the aromas of mother earth. we offer florist catering and event setups as well as bouquets for purchase at one of our many retail centers in the city",\n    "staggered": false,\n    "alignment": "center"\n}\n</example input 2>\n<example input 3>\nadd a free use image for the logo from undraw -- RAG Resource Images: \n</example input 3>\n</example inputs>\n\n\n<reference landing page screenshot urls>\nhttps://www.searchenginejournal.com/wp-content/uploads/2023/08/best-landing-page-examples-64e6080f990bb-sej.png\n\nhttps://neilpatel.com/wp-content/uploads/2023/06/Best_landing_pages2-1536x705.jpg\n\nhttps://neilpatel.com/wp-content/uploads/2023/06/Best_landing_pages6-1536x696.jpg\n\nhttps://neilpatel.com/wp-content/uploads/2023/06/Best_landing_pages9-1536x957.jpg\n</reference landing page screenshot urls>\n\n',
        messages: [...messages],
        model: "claude-3-sonnet-20240229",
        max_tokens: 4000,
      });

      let result = "";

      stream.on("text", (text) => {
        result += removeEscapeCharacters(text);
        res.write(removeEscapeCharacters(text));
      });

      stream.on("end", async () => {
        let this_history_id = history_id?.length > 0 ? history_id : uuidv4();
        let variant_id = uuidv4();
        const newVariant = new Variant({
          variant_id,
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
        res.write(
          `data:${JSON.stringify({
            history_id: this_history_id,
            variant_id,
            page_id,
          })}`
        );
        res.end();
      });

      stream.on("error", (error) => {
        console.error("Error:", error);
        console.log("ERROR LOGGING TRACE");
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

app.post("/anthropic/copy-generation/stream", authenticateJWT, async (req, res) => {
  try {
    const { landing_copy_object } = req.body;

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    const stream = await anthropic.messages.stream({
      system:
        '<system_prompt>\n\n<role>\nyour role is to ingest an object that contains properties with values that are short snippets of descriptive copy. Sometimes, the values will be blank and. You will output an object\n</role>\n\n<example_input>\n{\n    brand_name: "Mortecai",\n    brand_description:\n      "Mortecai is a revolutionary new way to build products. No more do you need to have the technical skills, money to hire developers, or a team behind you. With simple prompts, a few steeps, and a couple minutes, you can have a full stack application ready to deploy. Or, choose from one of our many generation options.",\n    image_configs: [\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362516106-landing-ai.png",\n        type: "logo",\n        copy: "",\n      },\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362523629-example-2.svg",\n        type: "hero",\n        copy: "",\n      },\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362532457-undraw_Static_website_re_x70h.png",\n        type: "feature",\n        copy: "No code",\n      },\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362541420-undraw_Team_up_re_84ok-(1).png",\n        type: "feature",\n        copy: "prompt to product",\n      },\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362555472-undraw_Design_inspiration_re_tftx.png",\n        type: "feature",\n        copy: "your dreams become reality",\n      },\n    ],\n  }\n</example_input>\n\n<example_output>\n{\n    brand_name: "Mortecai",\n    brand_description:\n      "Mortecai is a revolutionary new way to build products. No more do you need to have the technical skills, money to hire developers, or a team behind you. With simple prompts, a few steeps, and a couple minutes, you can have a full stack application ready to deploy. Or, choose from one of our many generation options.",\n    image_configs: [\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362516106-landing-ai.png",\n        type: "logo",\n        copy: <generated_copy>Add generated copy here</generated_copy>,\n      },\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362523629-example-2.svg",\n        type: "hero",\n        copy: <generated_copy>Add generated copy here</generated_copy>,\n      },\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362532457-undraw_Static_website_re_x70h.png",\n        type: "feature",\n        copy: <generated_copy>Add generated copy here based on the copy provided</generated_copy>,\n      },\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362541420-undraw_Team_up_re_84ok-(1).png",\n        type: "feature",\n        copy: <generated_copy>Add generated copy here based on the copy provided</generated_copy>,\n      },\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362555472-undraw_Design_inspiration_re_tftx.png",\n        type: "feature",\n        copy: <generated_copy>Add generated copy here based on the copy provided</generated_copy>,\n      },\n    ],\n  }\n</example_output>\n\n<output_rules>\n\n<rule>\nno xml tags should appear in the output\n<rule>\n<rule>\nthe output object should retain the same properties such as brand_deescription should not be renamed to brand_copy, copy, or description.\n<rule>\n<rule>\nthe provided urls must be included\n<rule>\n<rule>\nthe output should contain a keyword array\n<rule>\n<rule>\nfor each image, generate at least 300 words of copy\n<rule>\n<rule>\nonly output an object\n<rule>\n<rule>\nadditional copy can be added in the copy object such as copy for "suspected_industry", "competitive_analysis", and others as long as the copy is aligned well with the brand description\n<rule>\n\n</output_rules>\n\n</system_prompt>',
      messages: [
        {
          role: "user",
          content: JSON.stringify(landing_copy_object),
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

    stream.on("text", (text) => {
      res.write(text);
    });

    stream.on("end", () => {
      res.write("DONE"); // Send history_id as a separate event
      res.end();
    });

    stream.on("error", (error) => {
      console.error("Error:", error);
      res.status(500).json({ error: "An error occurred" });
    });
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
          '<instructions>\nYour task is to intake a json object and output a customized landing page written in HTML. Ensure that the design is visually appealing, responsive, and user-friendly. The HTML, CSS, and JavaScript code should be well-structured, efficiently organized, and properly commented for readability and maintainability. Ensure the output complies with the output specifications.\n\nSometimes the input will just be a simple string and not an object. If it is a string, make the changes requested in the string to the existing webpage and no other alterations. Then, output the updated webpage per the output specifications.\n</instructions>\n\n<Output Specifications>\nThe output should start with <!DOCTYPE html> and end with </html>.\n\nThe output should have and html header at the top of the page, main content, and a footer at the bottom of the page. The page should be a height of at least 100vh. \n\nThe output page should be SEO optimized.\n\nThe output page should be at no more than 3000px long and should have plenty of copy derived from provided brand industry and brand copy that fills the page. Add call to actions where necessary.\n\nInclude page animations and scroll animations for page content.\n</Output Specifications>\n\n<Rules>\n<Rule 1>\nThe generated HTML Page should always use normalize css as the base stylesheet which can be imported into the landing page using the below element:\n\n<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/normalize/8.0.1/normalize.min.css">\n</Rule 1>\n\n<Rule 2>\nNo content should horizontally overflow on the edges of the screen. If content is to overflow on the x plane, it needs to wrap.Overflow vertical content is acceptable.\n</Rule 2>\n\n<Rule 3>\nImages may be provided, if specified in the users prompt - apply the image where specified, otherwise analyze the image and place the image on the webpage somewhere and attach some relevant copy.\n</Rule 3>\n\n<Rule 4>\nThere must be a header, main section with all the content, and a footer. The header must have a left aligned logo image or logo text and right aligned buttons. The header should be no more than 60px in height. If the user requests the header to be styled differently, you must make the header style changes.\n</Rule 4>\n\n<Rule 5>\nWhen generating HTML and CSS for landing pages, make sure to include the following CSS rule to ensure the main content stretches to fill the remaining vertical space and the footer always stays at the bottom of the page:\n\ncss:\nbody {\n  display: flex;\n  flex-direction: column;\n  min-height: 400vh;\n}\n\nmain {\n  flex: 1;\n}\n</Rule 5>\n\n<Rule 6>\nThe min height of the body is 400vh. The entire height should be full of content including relevant industry information, brand copy, and images. If not enough copy is provided, derive copy from brand industry, brand_copy, and other relevant resources.\n</Rule 6>\n</Rules>\n\n<example inputs>\n<example input 1>\n{\n    "website_title": "Mortecai",\n    "theme": "dark",\n    "colors": {\n        "primary": "#9013fe",\n        "secondary": "#bd10e0",\n        "tertiary": "#ff5367"\n    },\n    "industry": "Generative AI, AI Web Development, AI, No Code",\n    "copy": "Mortecai is a generative ai solution that uses existing ai infrastructure, internal model training and alignment, and high quality source code to generate full stack web applications based on just a few prompts. The typical cost of building an mvp of a web app for a non technical founder is between $10k and $50k. Using Mortecai, we can reduce that cost by a factor of 10.\\n\\nOur beta now offers landing page generation and hosting. Please be prepared as we acquire funcing soon and launch mortecai into the starts. \\n\\nOur mission is to bring a software engineer into everyone\'s business. No technical skills required.. at all.. ever.. yeah..",\n    "staggered": true,\n    "alignment": "left"\n}\n</example input 1>\n<example input 2>\n{\n    "website_title": "Lavendar",\n    "theme": "light",\n    "colors": {\n        "primary": "#9013fe",\n        "secondary": "#bd10e0",\n        "tertiary": "#ff5367"\n    },\n    "industry": "Flower Growing, Florist, Flower Potting and Planting",\n    "copy": "Lavender is the premier florist for weddings, events, and birthdays in New York City. We bring you earth raised flowers still fresh with the aromas of mother earth. we offer florist catering and event setups as well as bouquets for purchase at one of our many retail centers in the city",\n    "staggered": false,\n    "alignment": "center"\n}\n</example input 2>\n<example input 3>\nadd a free use image for the logo from undraw -- RAG Resource Images: \n</example input 3>\n</example inputs>\n\n\n<reference landing page screenshot urls>\nhttps://www.searchenginejournal.com/wp-content/uploads/2023/08/best-landing-page-examples-64e6080f990bb-sej.png\n\nhttps://neilpatel.com/wp-content/uploads/2023/06/Best_landing_pages2-1536x705.jpg\n\nhttps://neilpatel.com/wp-content/uploads/2023/06/Best_landing_pages6-1536x696.jpg\n\nhttps://neilpatel.com/wp-content/uploads/2023/06/Best_landing_pages9-1536x957.jpg\n</reference landing page screenshot urls>\n\n',
        messages: [
          {
            role: "user",
            content: JSON.stringify(prompt),
          },
        ],
        model: "claude-3-sonnet-20240229",
        max_tokens: 4000,
        anthropic_beta: "tools-2024-04-04",
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

// app.post("/huggingface/inference", async (req, res) => {
//   try {
//     const { prompt = "give me an html landing page" } = req.body;
//     if (prompt) {
//       const inference = new HfInference(process.env.HF_INFERENCE_TOKEN_READ);
//       const model = inference.endpoint(
//         "https://j6po2oe02bi5644g.us-east-1.aws.endpoints.huggingface.cloud"
//       );
//       res.writeHead(200, {
//         "Content-Type": "text/event-stream",
//         "Cache-Control": "no-cache",
//         Connection: "keep-alive",
//       });
//       if (inference) {
//         const streamResponse = async () => {
//           const stream = await model.request({
//             inputs: prompt,
//             parameters: {
//               custom_parameter_1: "only return html as a string",
//               custom_parameter_2: "only use inline styling",
//               custom_parameter_3: "the html page should be the best landing page ever made",
//               custom_parameter_4: "a minimum output of 1000 lines of code is required"
//             },
//           });
//           let result = "";
//           stream.on("text", (text) => {
//             result += text;
//             res.write(text);
//           });
//           stream.on("end", async () => {
//             res.write(
//               `DONE`
//             );
//             res.end();
//           });
//           stream.on("error", (error) => {
//             console.error("Error:", error);
//             console.log("ERROR LOGGING TRACE");
//             res.status(500).end("An error occurred");
//           });
//         };

//         streamResponse();
//       }
//     }
//   } catch (error) {
//     console.error("Error:", error);
//     res.status(500).json({ error: "An error occurred" });
//   }
// });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
