const express = require("express");
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

// Secret key for JWT signing (change it to a strong, random value)
const SECRET_JWT = process.env.SECRET_JWT;

const app = express();
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

// test endpoint to verify server status
app.get("/", (req, res) => {
  console.log("received home");
  return res.status(200).json({ message: "working" });
});

// app.post("/anthropic/landing-page", async (req, res) => {
//   const { prompt } = req.body;
// });

app.post("/upload-image", upload.single("image"), async (req, res) => {
  try {
    // Establish a database connection
    await dbConnect(process.env.GEN_AUTH);

    const image = req.file;
    const uniqueFilename = `${Date.now()}-${image.originalname}`;
    const uploadDirectory = path.join(__dirname, "uploads");

    // Create the upload directory if it doesn't exist
    if (!fs.existsSync(uploadDirectory)) {
      fs.mkdirSync(uploadDirectory);
    }

    // Save the image file to the upload directory
    const imagePath = path.join(uploadDirectory, uniqueFilename);
    fs.writeFileSync(imagePath, image.buffer);

    // Save the image metadata to MongoDB
    const db = mongoose.connection.db;
    const result = await db.collection("images").insertOne({
      filename: uniqueFilename,
      contentType: image.mimetype,
    });

    // Generate the hosted URL for the image
    const hostedUrl = `${req.protocol}://${req.get(
      "host"
    )}/uploads/${uniqueFilename}`;

    res
      .status(200)
      .json({ message: "Image uploaded successfully", imageUrl: hostedUrl });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "An error occurred" });
  }
});

// Endpoint to serve uploaded images
app.get("/uploads/:filename", (req, res) => {
  const filename = req.params.filename;
  const imagePath = path.join(__dirname, "uploads", filename);

  // Check if the image file exists
  if (fs.existsSync(imagePath)) {
    res.sendFile(imagePath);
  } else {
    res.status(404).json({ error: "Image not found" });
  }
});

app.post("/anthropic/landing-page/stream", async (req, res) => {
  const { prompt } = req.body;

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const stream = await anthropic.messages.stream({
      system:
        'Objective: \nIngest an object which will look similar to the following:\n\n{website_title: "Kamari", theme: "dark", colors: {primary: "#9013FE", secondary: "#BD10E0", tertiary: "#FF5555"}, header: {signup: "/signup", pricing: "/pricing", features: {Invoicing: "#invoicing", client_management: "#client-management", time_tracking: "#time-tracking"}}, copy: "Kamari teams is a time tracking, task management, and invoicing tool, designed for freelancers. Freelancers can invite clients, track time against tasks, send invoices for hours worked, and clients can closely manage their product pipeline via task management. Kamari teams partners with stripe to bring invoicing to every freelancer. Kamari teams takes no portion of the money earned... no platform fees ever! Get started for free with no credit card required. Don\'t like it? No commitment."}\n\nEach feature in the features dropdown should have its own section on thee landing page. Clicking on the feature in the feature dropdown should scroll the user the the position of the features section. Additional sections should be added to the landing page that are found within the copy of the input. Images should be added to the landing page where necessary, such as for each feature, in the header (logo) and in the footer (logo).\n\nRules:\nThe output should not use global css definitions. It should use inline css. \n\nThe output landing page should be seo optimized using the latest seo trends.\n\nvariables such as staggered, alignment, and so on should be stored in a variable within the component and should never be omitted. These variables should not be props but hard coded constant. such as; const staggered = true;\n\nEnsure that the end user does not have to scroll at first to see some initial content. There should be a top section that is displayed after the page load.\n\nThe output should also have an object of required images. {header_logo: "", footer_logo: "", feature_invoicing: ""...}. The landing page that is generated should be react and should have all function definitions within the same output.\n\nThe output landing page should have a max header height of 60px unless specified within thee input object with the "header_height" key. \n\nThe initial content of the page should take up the entire height and width of the page and all other content should be found only when the user scrolls down. \n\nThe content that is found only when the user scrolls should load in on scroll.\n\nEach button should have a outline: none on focus. \n\nAdd copy to ensure the page feels full of content. The input will include an "industry" key which will be a string. Additional copy should be derived from industry competition. \n\nThe input object will include "alignment" key that indicates if the copy should be aligned left, center, or right.\n\nThe input may include a "staggered" key which if it is true, the features should stagger from text aligned left to aligned right.\n\nThe header should be vertically aligned so each item is centered vertically.\n\nfluff should be omitted from the response. The response should just be the component\n\nThe initial content should have an image within it. \n\nThe initial copy should not be the entire copy string but should be the key points of the copy string/should be derived from the copy.\n\nIf the mode/theme is dark the text color should be lighter and if the mode is light the text color should be darker.\n\nDO NOT INCLUDE ANY INLINE COMMENTS IN THE OUTPUT.\n\nTHE LANDING PAGE COMPONENT SHOULD HAVE MORE COPY THAN PROVIDED. ADD COPY THAT IS RELEVANT TO THE INDUSTRY/S PROVIDED. \n\nSystem RAG Resources:\nExample Landing Page Images: \n\nhttps://assets-global.website-files.com/5b5729421aca332c60585f78/63f5fa23da820b87c87958be_61ba503872080311dde1ea56_long-form-landing-page-examples.png\n\nhttps://neilpatel.com/wp-content/uploads/2023/06/Best_landing_pages3-700x397.jpg\n\nhttps://static.semrush.com/blog/uploads/media/ed/9b/ed9b42a338de806621bdaf70293c2e7e/image.png\n\nhttps://www.optimizepress.com/wp-content/uploads/2017/07/zendesk-landing-page-1024x566.png\n\nhttps://blog.hubspot.com/hs-fs/hubfs/fantastic-landing-page-examples_16.webp?width=650&height=353&name=fantastic-landing-page-examples_16.webp',
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

    stream.on("text", (text) => {
      res.write(`${text}`);
    });

    stream.on("end", () => {
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
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
