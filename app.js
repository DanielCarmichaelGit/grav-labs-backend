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

const User = require("./src/models/user");
const LandingPage = require("./src/models/landingPage");
const PageHistory = require("./src/models/pageHistory");
const MessageThread = require("./src/models/threads");

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

app.post("/upload-image", (req, res) => {
  upload.single("image")(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      // Handle multer errors
      console.error("Multer error:", err);
      return res.status(400).json({ error: "File upload error" });
    } else if (err) {
      // Handle other errors
      console.error("Error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }

    try {
      // Establish a database connection
      await dbConnect(process.env.GEN_AUTH);

      const image = req.file;

      if (!image) {
        return res.status(400).json({ error: "No image file provided" });
      }

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
});

app.post("/anthropic/modify-html/stream", authenticateJWT, async (req, res) => {
  const { prompt, html, initialPrompt, history_id } = req.body;

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
    const stream = await anthropic.messages.stream({
      system:
        'Caveat: If there is a provided html, make the alterations requested in the prompt. Do not make emore changes than requested and include no fluff in the response. The response should just include html. If initial html is provided, skip the rest of the system prompt until the examples portion. Make sure to only make alteerations noted in the users new input prompt. Objective: \nIngest an object which will look similar to the following:\n\n{website_title: "Kamari", theme: "dark", colors: {primary: "#9013FE", secondary: "#BD10E0", tertiary: "#FF5555"}, header: {signup: "/signup", pricing: "/pricing", features: {Invoicing: "#invoicing", client_management: "#client-management", time_tracking: "#time-tracking"}}, copy: "Kamari teams is a time tracking, task management, and invoicing tool, designed for freelancers. Freelancers can invite clients, track time against tasks, send invoices for hours worked, and clients can closely manage their product pipeline via task management. Kamari teams partners with stripe to bring invoicing to every freelancer. Kamari teams takes no portion of the money earned... no platform fees ever! Get started for free with no credit card required. Don\'t like it? No commitment."}\n\nPriorities:\nThe output of the prompt should be an html page complete with all tags. No fluff at the beginning or end of the output should be included. There will be no inline comments. Again, no inline comments. Also, all of the styling is done inline. No additional packages, libraries, or frameworks that are not native to js or html are allowed.\n\nThe system has been provided with example landing page images. The system will use these images as a creative reference for the output but will not copy them one to one.\n\nRules: (Note: The prompt will be a json stringified object)\n\n(Theme and Font Colors) The prompt includes a theme key; dark or light. If the theme is dark, the font color should be light or should be one of the provided colors in the color object. If the theme is light, the font colors should be dark or one of the provided colors in the color object.\n\n(Header and Features) The prompt includes a header key and a features key. Both the keys will have the same value. Each key in the headers key will be a header button. If the value of the key is a string and starts with / then the button will redirect users to a new page. If the value of the key is an object, then the header button will be a dropdown containing each value in the parent keys value object. Upon clicking the item in the dropdown, the page should smoothly scroll to the associated feature on the page. It is important that the scroll behavior is smooth. !!Important!! ensure that the header is positioned relative.\n\nFor each key in the features object, there will be a section of the page for that feature. The feature should have some copy associated with it. And should have an image associated with it. If the value of the staggered key is "true" then the list of features should alternate between text - image and image - text. Essentially, alternating between row and row reversed.\n\n(Copy) The prompt will include a short snippet of copy. The copy is meant to be a starter. Do not just paste this block of copy. Add more details, make it seo friendly, and include a lot moree copy on the page where needed.\n\n(Alignment) The prompt will include an alignment key. This keys value represents the text alignment of the text elements in the output. \n\n(Additional Sections) The prompt will include an additional sections key. If there is a value for this key that is not an empty string. Create a section for each additional section specified in the keys value.\n\n(Website Title) The prompt will include a website title. Be sure to include this website title in the header. \n\n(Header) The prompt will not include any styling beyond alignment and colors. The header should be a standard header. The Header will have a maximum height of 60px. The header logo div should not have a height that exceeds 60px but the width can exceed 60px. The dropdowns in the header should never fall outside the width of the screen. If the dropdown were to fall outside the width of the screen then make sure to shift thee dropdown to not fall outside the screen.\n\n(Hero) The prompt will not include a hero section but the output will have a hero section that is the initial page content. \n\n(Footer) The prompt will not include any information about the footer but be sure to include a copyright and any other copy like "Thank you for visiting [website title]" or something to that effect.\n\nThe output will not include any fluff text and will just be the html page. The output will also not include any inline comments.\n\nThe content of the html page should show on scroll except the initial content. The initial content will always be displayed. \n\nFinal Note:\nThe page should be responsive in design. The page should also include simple animations like (slide in on scroll and appear/fade in on scroll)\n\nSystem RAG Resources:\nExample Landing Page Images: \n\nhttps://assets-global.website-files.com/5b5729421aca332c60585f78/63f5fa23da820b87c87958be_61ba503872080311dde1ea56_long-form-landing-page-examples.png\n\nhttps://neilpatel.com/wp-content/uploads/2023/06/Best_landing_pages3-700x397.jpg\n\nhttps://static.semrush.com/blog/uploads/media/ed/9b/ed9b42a338de806621bdaf70293c2e7e/image.png\n\nhttps://www.optimizepress.com/wp-content/uploads/2017/07/zendesk-landing-page-1024x566.png\n\nhttps://blog.hubspot.com/hs-fs/hubfs/fantastic-landing-page-examples_16.webp?width=650&height=353&name=fantastic-landing-page-examples_16.webp',
      messages: [
        ...messages
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
      result += text;
      res.write(`${text}`);
    });

    stream.on("end", async () => {
      const page_id = uuidv4();
      let this_history_id = history_id?.length > 0 ? history_id : uuidv4();
      const newHistory = new PageHistory({
        history_id: this_history_id,
        user_id: req.user.user.user_id,
        page_id,
        timestamp: Date.now(),
        content: result,
      });

      await newHistory.save();

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
  } catch (error) {
    console.error("Error:", error);
    res.status(500).end("An error occurred");
  }
});

// Endpoint to serve uploaded images
app.get("/uploads/:filename", authenticateJWT, (req, res) => {
  const filename = req.params.filename;
  const imagePath = path.join(__dirname, "uploads", filename);

  // Check if the image file exists
  if (fs.existsSync(imagePath)) {
    res.sendFile(imagePath);
  } else {
    res.status(404).json({ error: "Image not found" });
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
          'Objective: \nIngest an object which will look similar to the following:\n\n{website_title: "Kamari", theme: "dark", colors: {primary: "#9013FE", secondary: "#BD10E0", tertiary: "#FF5555"}, header: {signup: "/signup", pricing: "/pricing", features: {Invoicing: "#invoicing", client_management: "#client-management", time_tracking: "#time-tracking"}}, copy: "Kamari teams is a time tracking, task management, and invoicing tool, designed for freelancers. Freelancers can invite clients, track time against tasks, send invoices for hours worked, and clients can closely manage their product pipeline via task management. Kamari teams partners with stripe to bring invoicing to every freelancer. Kamari teams takes no portion of the money earned... no platform fees ever! Get started for free with no credit card required. Don\'t like it? No commitment."}\n\nPriorities:\nThe output of the prompt should be an html page complete with all tags. No fluff at the beginning or end of the output should be included. There will be no inline comments. Again, no inline comments. Also, all of the styling is done inline. No additional packages, libraries, or frameworks that are not native to js or html are allowed.\n\nThe system has been provided with example landing page images. The system will use these images as a creative reference for the output but will not copy them one to one.\n\nRules: (Note: The prompt will be a json stringified object)\n\n(Theme and Font Colors) The prompt includes a theme key; dark or light. If the theme is dark, the font color should be light or should be one of the provided colors in the color object. If the theme is light, the font colors should be dark or one of the provided colors in the color object.\n\n(Header and Features) The prompt includes a header key and a features key. Both the keys will have the same value. Each key in the headers key will be a header button. If the value of the key is a string and starts with / then the button will redirect users to a new page. If the value of the key is an object, then the header button will be a dropdown containing each value in the parent keys value object. Upon clicking the item in the dropdown, the page should smoothly scroll to the associated feature on the page. It is important that the scroll behavior is smooth. !!Important!! ensure that the header is positioned relative.\n\nFor each key in the features object, there will be a section of the page for that feature. The feature should have some copy associated with it. And should have an image associated with it. If the value of the staggered key is "true" then the list of features should alternate between text - image and image - text. Essentially, alternating between row and row reversed.\n\n(Copy) The prompt will include a short snippet of copy. The copy is meant to be a starter. Do not just paste this block of copy. Add more details, make it seo friendly, and include a lot moree copy on the page where needed.\n\n(Alignment) The prompt will include an alignment key. This keys value represents the text alignment of the text elements in the output. \n\n(Additional Sections) The prompt will include an additional sections key. If there is a value for this key that is not an empty string. Create a section for each additional section specified in the keys value.\n\n(Website Title) The prompt will include a website title. Be sure to include this website title in the header. \n\n(Header) The prompt will not include any styling beyond alignment and colors. The header should be a standard header. The Header will have a maximum height of 60px. The header logo div should not have a height that exceeds 60px but the width can exceed 60px. The dropdowns in the header should never fall outside the width of the screen. If the dropdown were to fall outside the width of the screen then make sure to shift thee dropdown to not fall outside the screen.\n\n(Hero) The prompt will not include a hero section but the output will have a hero section that is the initial page content. \n\n(Footer) The prompt will not include any information about the footer but be sure to include a copyright and any other copy like "Thank you for visiting [website title]" or something to that effect.\n\nThe output will not include any fluff text and will just be the html page. The output will also not include any inline comments.\n\nThe content of the html page should show on scroll except the initial content. The initial content will always be displayed. \n\nFinal Note:\nThe page should be responsive in design. The page should also include simple animations like (slide in on scroll and appear/fade in on scroll)\n\nSystem RAG Resources:\nExample Landing Page Images: \n\nhttps://assets-global.website-files.com/5b5729421aca332c60585f78/63f5fa23da820b87c87958be_61ba503872080311dde1ea56_long-form-landing-page-examples.png\n\nhttps://neilpatel.com/wp-content/uploads/2023/06/Best_landing_pages3-700x397.jpg\n\nhttps://static.semrush.com/blog/uploads/media/ed/9b/ed9b42a338de806621bdaf70293c2e7e/image.png\n\nhttps://www.optimizepress.com/wp-content/uploads/2017/07/zendesk-landing-page-1024x566.png\n\nhttps://blog.hubspot.com/hs-fs/hubfs/fantastic-landing-page-examples_16.webp?width=650&height=353&name=fantastic-landing-page-examples_16.webp',
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
        result += text;
        res.write(`${text}`);
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
        res.write(`data:${JSON.stringify({ history_id })}`); // Send history_id as a separate event
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

app.get("/threads", authenticateJWT, async (req, res) => {
  try {
    const user_id = req.user.user.user_id;

    if (user_id) {
      dbConnect(process.env.GEN_AUTH);

      const threads = await MessageThread.find({ user_id });

      res.status(200).json({
        message: "threads found",
        count: threads.length,
        threads
      })
    } else {
      res.status(404).json({
        message: "No user found"
      })
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "An error occurred" });
  }
})

app.get("/pages", authenticateJWT, async (req, res) => {
  try {
    const user_id = req.user.user.user_id;

    if (user_id) {
      dbConnect(process.env.GEN_AUTH);

      const pages = await PageHistory.find({ user_id }).select("timestamp content history_id page_id");

      res.status(200).json({
        message: "pages found",
        count: pages.length,
        pages
      })
    } else {
      res.status(404).json({
        message: "No user found"
      })
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "An error occurred" });
  }
})

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
