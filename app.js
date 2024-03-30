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
        'Objective: \nIngest an object which will look similar to the following:\n\n{website_title: "Kamari", theme: "dark", colors: {primary: "#9013FE", secondary: "#BD10E0", tertiary: "#FF5555"}, header: {signup: "/signup", pricing: "/pricing", features: {Invoicing: "#invoicing", client_management: "#client-management", time_tracking: "#time-tracking"}}, copy: "Kamari teams is a time tracking, task management, and invoicing tool, designed for freelancers. Freelancers can invite clients, track time against tasks, send invoices for hours worked, and clients can closely manage their product pipeline via task management. Kamari teams partners with stripe to bring invoicing to every freelancer. Kamari teams takes no portion of the money earned... no platform fees ever! Get started for free with no credit card required. Don\'t like it? No commitment."}\n\nPriorities:\nThe output of the prompt should be an html page complete with all tags. No fluff at the beginning or end of the output should be included. There will be no inline comments. \n\nThe system has been provided with example landing page images. The system will use these images as a creative reference for the output but will not copy them one to one.\n\nRules: (Note: The prompt will be a json stringified object)\n\n(Theme and Font Colors) The prompt includes a theme key; dark or light. If the theme is dark, the font color should be light or should be one of the provided colors in the color object. If the theme is light, the font colors should be dark or one of the provided colors in the color object.\n\n(Header and Features) The prompt includes a header key and a features key. Both the keys will have the same value. Each key in the headers key will be a header button. If the value of the key is a string and starts with / then the button will redirect users to a new page. If the value of the key is an object, then the header button will be a dropdown containing each value in the parent keys value object. Upon clicking the item in the dropdown, the page should smoothly scroll to the associated feature on the page.\n\nFor each key in the features object, there will be a section of the page for that feature. The feature should have some copy associated with it. And should have an image associated with it. If the value of the staggered key is "true" then the list of features should alternate between text - image and image - text. Essentially, alternating between row and row reversed.\n\n(Copy) The prompt will include a short snippet of copy. The copy is meant to be a starter. Do not just paste this block of copy. Add more details, make it seo friendly, and include a lot moree copy on the page where needed.\n\n(Alignment) The prompt will include an alignment key. This keys value represents the text alignment of the text elements in the output. \n\n(Website Title) The prompt will include a website title. Be sure to include this website title in the header. \n\n(Header) The prompt will not include any styling beyond alignment and colors. The header should be a standard header.\n\n(Footer) The prompt will not include any information about the footer but be sure to include a copyright and any other copy like "Thank you for visiting [website title]" or something to that effect.\n\nThe output will not include any fluff text and will just be the html page. The output will also not include any inline comments.\n\nThe content of the html page should show on scroll except the initial content. The initial content will always be displayed. \n\nSystem RAG Resources:\nExample Landing Page Images: \n\nhttps://assets-global.website-files.com/5b5729421aca332c60585f78/63f5fa23da820b87c87958be_61ba503872080311dde1ea56_long-form-landing-page-examples.png\n\nhttps://neilpatel.com/wp-content/uploads/2023/06/Best_landing_pages3-700x397.jpg\n\nhttps://static.semrush.com/blog/uploads/media/ed/9b/ed9b42a338de806621bdaf70293c2e7e/image.png\n\nhttps://www.optimizepress.com/wp-content/uploads/2017/07/zendesk-landing-page-1024x566.png\n\nhttps://blog.hubspot.com/hs-fs/hubfs/fantastic-landing-page-examples_16.webp?width=650&height=353&name=fantastic-landing-page-examples_16.webp',
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
