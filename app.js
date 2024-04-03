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
          'Objective: \nIngest an object which will look similar to the following:\n\n{\n    "website_title": "Mortecai",\n    "theme": "dark",\n    "colors": {\n        "primary": "#9013fe",\n        "secondary": "#bd10e0",\n        "tertiary": "#ff5367"\n    },\n    "industry": "Generative AI, AI Web Development, AI, No Code",\n    "copy": "Mortecai is a generative ai solution that uses existing ai infrastructure, internal model training and alignment, and high quality source code to generate full stack web applications based on just a few prompts. The typical cost of building an mvp of a web app for a non technical founder is between $10k and $50k. Using Mortecai, we can reduce that cost by a factor of 10.\\n\\nOur beta now offers landing page generation and hosting. Please be prepared as we acquire funcing soon and launch mortecai into the starts. \\n\\nOur mission is to bring a software engineer into everyone\'s business. No technical skills required.. at all.. ever.. yeah..",\n    "staggered": true,\n    "alignment": "left"\n}\n\nThe output of the prompt should be a clean and valid HTML page, complete with all necessary tags. The HTML code should be free of any escape characters, such as \\t and \\n, and should not be enclosed in quotes or any other characters that would prevent it from being rendered correctly in a browser. The output should only contain the HTML code itself, without any additional explanations, comments, or fluff.\n\nPriorities:\nThe output of the prompt should be an html page complete with all tags. No fluff at the beginning or end of the output should be included. There will be no inline comments. Again, no inline comments. Also, all of the styling is done inline. No additional packages, libraries, or frameworks that are not native to js or html are allowed.\n\nThe system has been provided with example landing page images. The system will use these images as a creative reference for the output but will not copy them one to one.\n\nRules: (Note: The prompt will be a json stringified object)\n\n(Theme and Font Colors) The prompt includes a theme key; dark or light. If the theme is dark, the font color should be light or should be one of the provided colors in the color object. If the theme is light, the font colors should be dark or one of the provided colors in the color object.\n\n(Header and Features) The prompt includes a header key and a features key. Both the keys will have the same value. Each key in the headers key will be a header button. If the value of the key is a string and starts with / then the button will redirect users to a new page. If the value of the key is an object, then the header button will be a dropdown containing each value in the parent keys value object. Upon clicking the item in the dropdown, the page should smoothly scroll to the associated feature on the page. It is important that the scroll behavior is smooth. !!Important!! ensure that the header is positioned relative.\n\nFor each key in the features object, there will be a section of the page for that feature. The feature should have some copy associated with it. And should have an image associated with it. If the value of the staggered key is "true" then the list of features should alternate between text - image and image - text. Essentially, alternating between row and row reversed.\n\n(Copy) The prompt will include a short snippet of copy. The copy is meant to be a starter. Do not just paste this block of copy. Add more details, make it seo friendly, and include a lot moree copy on the page where needed.\n\n(Alignment) The prompt will include an alignment key. This keys value represents the text alignment of the text elements in the output. \n\n(Additional Sections) The prompt will include an additional sections key. If there is a value for this key that is not an empty string. Create a section for each additional section specified in the keys value.\n\n(Website Title) The prompt will include a website title. Be sure to include this website title in the header. \n\n(Header) The prompt will not include any styling beyond alignment and colors. The header should be a standard header. The Header will have a maximum height of 60px. The header logo div should not have a height that exceeds 60px but the width can exceed 60px. The dropdowns in the header should never fall outside the width of the screen. If the dropdown were to fall outside the width of the screen then make sure to shift thee dropdown to not fall outside the screen.\n\n(Clean and Valid HTML) The output should be clean and valid HTML code. It should not contain any escape characters like \\t or \\n, and should not be enclosed in quotes or any other characters that would prevent it from being rendered correctly in a browser. The HTML code should be properly formatted and indented for readability, but should not include any inline comments or explanations.\n\n(Sections)\n\n(Hero) The prompt will not include a hero section but the output will have a hero section that is the initial page content. \n\n(Footer) The prompt will not include any information about the footer but be sure to include a copyright and any other copy like "Thank you for visiting [website title]" or something to that effect.\n\nThe output will not include any fluff text and will just be the html page. The output will also not include any inline comments.\n\nThe content of the html page should show on scroll except the initial content. The initial content will always be displayed. \n\nFinal Note:\nThe page should be responsive in design and include simple animations like slide-in on scroll and appear/fade-in on scroll. The output should be clean and valid HTML code, free of any escape characters or additional characters that would prevent it from being rendered correctly in a browser. The HTML code should be properly formatted and indented for readability.\n\nSystem RAG Resources:\nadditional resources may be added as urls. If the url is an image, include the image in the landing page. There should be some information provided in the prompt as to where the image goes on the landing page. If not, include the image somewhere in the landing page and add some copy to the image related to the image and the brand generating the landing page.\n\nThe below images ARE NOT images to be included in the output but to be used as reference resources on what a good landing page looks like.\n\nExample Landing Page Images: \n\nhttps://assets-global.website-files.com/5b5729421aca332c60585f78/63f5fa23da820b87c87958be_61ba503872080311dde1ea56_long-form-landing-page-examples.png\n\nhttps://neilpatel.com/wp-content/uploads/2023/06/Best_landing_pages3-700x397.jpg\n\nhttps://static.semrush.com/blog/uploads/media/ed/9b/ed9b42a338de806621bdaf70293c2e7e/image.png\n\nhttps://www.optimizepress.com/wp-content/uploads/2017/07/zendesk-landing-page-1024x566.png\n\nhttps://blog.hubspot.com/hs-fs/hubfs/fantastic-landing-page-examples_16.webp?width=650&height=353&name=fantastic-landing-page-examples_16.webp\n\n\nExample Output:\n<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>Landing Ai</title>\n    <style>\n      * {\n        margin: 0;\n        padding: 0;\n        box-sizing: border-box;\n        font-family: Arial, sans-serif;\n      }\n      body {\n        background-color: #fff;\n        color: #333;\n        line-height: 1.6;\n      }\n      header {\n        display: flex;\n        justify-content: space-between;\n        align-items: center;\n        padding: 1rem;\n        background-color: #fff;\n        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);\n        position: relative;\n        z-index: 1;\n      }\n      nav ul {\n        display: flex;\n        list-style: none;\n      }\n      nav ul li {\n        margin-left: 1rem;\n      }\n      nav ul li a {\n        color: #333;\n        text-decoration: none;\n      }\n      .dropdown {\n        position: relative;\n        display: inline-block;\n      }\n      .dropdown-content {\n        display: none;\n        position: absolute;\n        background-color: #f9f9f9;\n        min-width: 160px;\n        box-shadow: 0px 8px 16px 0px rgba(0, 0, 0, 0.2);\n        z-index: 1;\n        right: 0;\n      }\n      .dropdown-content a {\n        color: #333;\n        padding: 12px 16px;\n        text-decoration: none;\n        display: block;\n      }\n      .dropdown-content a:hover {\n        background-color: #ddd;\n      }\n      .dropdown:hover .dropdown-content {\n        display: block;\n      }\n      .hero {\n        background-color: #f8f9fa;\n        padding: 4rem 2rem;\n        text-align: left;\n      }\n      .hero h1 {\n        font-size: 3rem;\n        margin-bottom: 1rem;\n      }\n      .hero p {\n        font-size: 1.2rem;\n        margin-bottom: 2rem;\n      }\n      .btn {\n        display: inline-block;\n        background-color: #9013fe;\n        color: #fff;\n        padding: 0.8rem 1.5rem;\n        text-decoration: none;\n        border-radius: 4px;\n        transition: background-color 0.3s ease;\n      }\n      .btn:hover {\n        background-color: #bd10e0;\n        color: #fff; /* Add this line to set button font color to white on hover */\n      }\n      section {\n        padding: 4rem 2rem;\n      }\n      section h2 {\n        font-size: 2rem;\n        margin-bottom: 2rem;\n        color: #9013fe;\n      }\n      .feature {\n        display: flex;\n        flex-wrap: wrap;\n        align-items: center;\n        justify-content: space-between;\n        margin-bottom: 2rem;\n      }\n      .feature img {\n        max-width: 40%;\n        margin-right: 2rem;\n      }\n      .feature-text {\n        flex: 1;\n      }\n      .feature-text h3 {\n        font-size: 1.5rem;\n        margin-bottom: 1rem;\n      }\n      .pricing {\n        display: flex;\n        justify-content: center;\n        margin-bottom: 2rem;\n        flex-wrap: wrap;\n      }\n      .pricing-card {\n        background-color: #fff;\n        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);\n        padding: 2rem;\n        text-align: center;\n        flex: 1 1 300px;\n        margin: 1rem;\n        transition: transform 0.3s ease;\n        border-radius: 10px;\n      }\n      .pricing-card:hover {\n        transform: translateY(-5px);\n      }\n      .pricing-card h3 {\n        font-size: 1.5rem;\n        margin-bottom: 1rem;\n      }\n      .pricing-card p {\n        font-size: 1.2rem;\n        margin-bottom: 1rem;\n      }\n      .pricing-card .price {\n        font-size: 2rem;\n        font-weight: bold;\n        margin-bottom: 1rem;\n      }\n      .pricing-card .btn {\n        margin-top: 1rem;\n      }\n      .video-section {\n        background-color: #f8f9fa;\n        padding: 4rem 2rem;\n        text-align: center;\n      }\n      .video-section h2 {\n        font-size: 2rem;\n        margin-bottom: 2rem;\n        color: #9013fe;\n      }\n      .video-container {\n        position: relative;\n        padding-bottom: 56.25%;\n        height: 0;\n        overflow: hidden;\n        max-width: 800px;\n        margin: 0 auto;\n      }\n      .video-container iframe {\n        position: absolute;\n        top: 0;\n        left: 0;\n        width: 100%;\n        height: 100%;\n      }\n      footer {\n        background-color: #333;\n        color: #fff;\n        padding: 2rem;\n        text-align: center;\n      }\n      footer p {\n        margin-bottom: 1rem;\n      }\n      @media (max-width: 768px) {\n        header {\n          flex-direction: column;\n          align-items: flex-start;\n        }\n        nav ul {\n          flex-direction: column;\n          margin-top: 1rem;\n        }\n        nav ul li {\n          margin-left: 0;\n          margin-bottom: 0.5rem;\n        }\n        .feature {\n          flex-direction: column;\n          text-align: center;\n        }\n        .feature img {\n          max-width: 100%;\n          margin-right: 0;\n          margin-bottom: 1rem;\n        }\n        .pricing {\n          flex-direction: column;\n          align-items: center;\n        }\n        .pricing-card {\n          margin: 1rem 0;\n        }\n      }\n    </style>\n  </head>\n  <body>\n    <header>\n      <a href="landing.html"\n        ><img\n          src="http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1711940763864-landing-ai.png"\n          alt="Landing Ai Logo"\n          height="60"\n      /></a>\n      <nav>\n        <ul>\n          <li><a href="/signup">Signup</a></li>\n          <li><a href="#pricing">Pricing</a></li>\n          <li class="dropdown">\n            <a href="#">Features</a>\n            <div class="dropdown-content">\n              <a href="#iteration">Iteration</a>\n              <a href="#prompt-to-ui">Prompt to UI</a>\n              <a href="#no-code">No Code</a>\n            </div>\n          </li>\n        </ul>\n      </nav>\n    </header>\n    <section class="hero">\n      <h1>Revolutionize Your Landing Page Creation with AI</h1>\n      <p>\n        Landing Ai is a groundbreaking platform that leverages the power of\n        artificial intelligence to generate stunning, optimized landing pages\n        for your business. Say goodbye to the hassle of coding and design, and\n        hello to a seamless, no-code experience that will elevate your online\n        presence.\n      </p>\n      <a href="#" class="btn">Get Started</a>\n    </section>\n    <section>\n      <h2>Pricing</h2>\n      <div id="pricing" class="pricing">\n        <div class="pricing-card">\n          <h3>Basic</h3>\n          <p>Perfect for individuals and small businesses.</p>\n          <p class="price">$49/month</p>\n          <ul>\n            <li>Up to 5 landing pages</li>\n            <li>Basic analytics</li>\n            <li>Limited customization</li>\n          </ul>\n          <a href="#" class="btn">Buy Now</a>\n        </div>\n        <div class="pricing-card">\n          <h3>Pro</h3>\n          <p>For growing businesses and agencies.</p>\n          <p class="price">$79/month</p>\n          <ul>\n            <li>Unlimited landing pages</li>\n            <li>Advanced analytics</li>\n            <li>Custom domain support</li>\n          </ul>\n          <a href="#" class="btn">Buy Now</a>\n        </div>\n        <div class="pricing-card">\n          <h3>Enterprise</h3>\n          <p>For large organizations and enterprises.</p>\n          <p class="price">$99/month</p>\n          <ul>\n            <li>Unlimited landing pages</li>\n            <li>Advanced analytics</li>\n            <li>Custom domain support</li>\n            <li>Priority support</li>\n          </ul>\n          <a href="#" class="btn">Buy Now</a>\n        </div>\n      </div>\n    </section>\n    <section>\n      <h2>Features</h2>\n      <div class="feature">\n        <img\n          src="http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1711941027618-undraw_Team_up_re_84ok-(1).png"\n          alt="Iteration"\n        />\n        <div class="feature-text">\n          <h3 id="iteration">Iteration</h3>\n          <p>\n            With Landing Ai, you can effortlessly iterate and refine your\n            landing page designs. Our AI-powered platform allows you to quickly\n            generate multiple variations, ensuring you find the perfect layout\n            and messaging for your target audience.\n          </p>\n        </div>\n      </div>\n      <div class="feature">\n        <div class="feature-text">\n          <h3 id="prompt-to-ui">Prompt to UI</h3>\n          <p>\n            Our cutting-edge technology transforms your prompts into visually\n            stunning and highly functional user interfaces. Simply provide your\n            requirements, and let Landing Ai work its magic, creating a stunning\n            landing page tailored to your specifications.\n          </p>\n        </div>\n        <img\n          src="http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1711941094043-undraw_Mobile_interface_re_1vv9.png"\n          alt="Prompt to UI"\n        />\n      </div>\n      <div class="feature">\n        <img\n          src="http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1711940832024-undraw_Static_website_re_x70h.png"\n          alt="No Code"\n        />\n        <div class="feature-text">\n          <h3 id="no-code">No Code</h3>\n          <p>\n            Landing Ai\'s no-code approach empowers you to create\n            professional-grade landing pages without the need for coding skills\n            or extensive design knowledge. Our user-friendly interface ensures a\n            seamless experience, allowing you to focus on your business goals\n            while we handle the technical aspects.\n          </p>\n        </div>\n      </div>\n    </section>\n    <section class="video-section">\n      <h2>Watch Our Demo</h2>\n      <div class="video-container">\n        <iframe\n          width="560"\n          height="315"\n          src="https://www.youtube.com/embed/h_XrF3WDAzw"\n          frameborder="0"\n          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"\n          allowfullscreen\n        ></iframe>\n      </div>\n    </section>\n    <footer>\n      <p>&copy; 2023 Landing Ai. All rights reserved.</p>\n      <p>Thank you for visiting Landing Ai.</p>\n    </footer>\n  </body>\n</html>\n\n\nExample Output:\n',
        messages: [...messages],
        model: "claude-3-sonnet-20240229",
        max_tokens: 4000,
        temperature: 0.5,
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
          system: "Objective: \nIngest an object which will look similar to the following:\n\n{\n    \"website_title\": \"Mortecai\",\n    \"theme\": \"dark\",\n    \"colors\": {\n        \"primary\": \"#9013fe\",\n        \"secondary\": \"#bd10e0\",\n        \"tertiary\": \"#ff5367\"\n    },\n    \"industry\": \"Generative AI, AI Web Development, AI, No Code\",\n    \"copy\": \"Mortecai is a generative ai solution that uses existing ai infrastructure, internal model training and alignment, and high quality source code to generate full stack web applications based on just a few prompts. The typical cost of building an mvp of a web app for a non technical founder is between $10k and $50k. Using Mortecai, we can reduce that cost by a factor of 10.\\n\\nOur beta now offers landing page generation and hosting. Please be prepared as we acquire funcing soon and launch mortecai into the starts. \\n\\nOur mission is to bring a software engineer into everyone's business. No technical skills required.. at all.. ever.. yeah..\",\n    \"staggered\": true,\n    \"alignment\": \"left\"\n}\n\nThe output of the prompt should be a clean and valid HTML page, complete with all necessary tags. The HTML code should be free of any escape characters, such as \\t and \\n, and should not be enclosed in quotes or any other characters that would prevent it from being rendered correctly in a browser. The output should only contain the HTML code itself, without any additional explanations, comments, or fluff.\n\nPriorities:\nThe output of the prompt should be an html page complete with all tags. No fluff at the beginning or end of the output should be included. There will be no inline comments. Again, no inline comments. Also, all of the styling is done inline. No additional packages, libraries, or frameworks that are not native to js or html are allowed.\n\nThe system has been provided with example landing page images. The system will use these images as a creative reference for the output but will not copy them one to one.\n\nRules: (Note: The prompt will be a json stringified object)\n\n(Theme and Font Colors) The prompt includes a theme key; dark or light. If the theme is dark, the font color should be light or should be one of the provided colors in the color object. If the theme is light, the font colors should be dark or one of the provided colors in the color object.\n\n(Header and Features) The prompt includes a header key and a features key. Both the keys will have the same value. Each key in the headers key will be a header button. If the value of the key is a string and starts with / then the button will redirect users to a new page. If the value of the key is an object, then the header button will be a dropdown containing each value in the parent keys value object. Upon clicking the item in the dropdown, the page should smoothly scroll to the associated feature on the page. It is important that the scroll behavior is smooth. !!Important!! ensure that the header is positioned relative.\n\nFor each key in the features object, there will be a section of the page for that feature. The feature should have some copy associated with it. And should have an image associated with it. If the value of the staggered key is \"true\" then the list of features should alternate between text - image and image - text. Essentially, alternating between row and row reversed.\n\n(Copy) The prompt will include a short snippet of copy. The copy is meant to be a starter. Do not just paste this block of copy. Add more details, make it seo friendly, and include a lot moree copy on the page where needed.\n\n(Alignment) The prompt will include an alignment key. This keys value represents the text alignment of the text elements in the output. \n\n(Additional Sections) The prompt will include an additional sections key. If there is a value for this key that is not an empty string. Create a section for each additional section specified in the keys value.\n\n(Website Title) The prompt will include a website title. Be sure to include this website title in the header. \n\n(Header) The prompt will not include any styling beyond alignment and colors. The header should be a standard header. The Header will have a maximum height of 60px. The header logo div should not have a height that exceeds 60px but the width can exceed 60px. The dropdowns in the header should never fall outside the width of the screen. If the dropdown were to fall outside the width of the screen then make sure to shift thee dropdown to not fall outside the screen.\n\n(Clean and Valid HTML) The output should be clean and valid HTML code. It should not contain any escape characters like \\t or \\n, and should not be enclosed in quotes or any other characters that would prevent it from being rendered correctly in a browser. The HTML code should be properly formatted and indented for readability, but should not include any inline comments or explanations.\n\n(Sections)\n\n(Hero) The prompt will not include a hero section but the output will have a hero section that is the initial page content. \n\n(Footer) The prompt will not include any information about the footer but be sure to include a copyright and any other copy like \"Thank you for visiting [website title]\" or something to that effect.\n\nThe output will not include any fluff text and will just be the html page. The output will also not include any inline comments.\n\nThe content of the html page should show on scroll except the initial content. The initial content will always be displayed. \n\nFinal Note:\nThe page should be responsive in design and include simple animations like slide-in on scroll and appear/fade-in on scroll. The output should be clean and valid HTML code, free of any escape characters or additional characters that would prevent it from being rendered correctly in a browser. The HTML code should be properly formatted and indented for readability.\n\nSystem RAG Resources:\nadditional resources may be added as urls. If the url is an image, include the image in the landing page. There should be some information provided in the prompt as to where the image goes on the landing page. If not, include the image somewhere in the landing page and add some copy to the image related to the image and the brand generating the landing page.\n\nThe below images ARE NOT images to be included in the output but to be used as reference resources on what a good landing page looks like.\n\nExample Landing Page Images: \n\nhttps://assets-global.website-files.com/5b5729421aca332c60585f78/63f5fa23da820b87c87958be_61ba503872080311dde1ea56_long-form-landing-page-examples.png\n\nhttps://neilpatel.com/wp-content/uploads/2023/06/Best_landing_pages3-700x397.jpg\n\nhttps://static.semrush.com/blog/uploads/media/ed/9b/ed9b42a338de806621bdaf70293c2e7e/image.png\n\nhttps://www.optimizepress.com/wp-content/uploads/2017/07/zendesk-landing-page-1024x566.png\n\nhttps://blog.hubspot.com/hs-fs/hubfs/fantastic-landing-page-examples_16.webp?width=650&height=353&name=fantastic-landing-page-examples_16.webp\n\n\nExample Output:\n<!DOCTYPE html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n    <title>Landing Ai</title>\n    <style>\n      * {\n        margin: 0;\n        padding: 0;\n        box-sizing: border-box;\n        font-family: Arial, sans-serif;\n      }\n      body {\n        background-color: #fff;\n        color: #333;\n        line-height: 1.6;\n      }\n      header {\n        display: flex;\n        justify-content: space-between;\n        align-items: center;\n        padding: 1rem;\n        background-color: #fff;\n        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);\n        position: relative;\n        z-index: 1;\n      }\n      nav ul {\n        display: flex;\n        list-style: none;\n      }\n      nav ul li {\n        margin-left: 1rem;\n      }\n      nav ul li a {\n        color: #333;\n        text-decoration: none;\n      }\n      .dropdown {\n        position: relative;\n        display: inline-block;\n      }\n      .dropdown-content {\n        display: none;\n        position: absolute;\n        background-color: #f9f9f9;\n        min-width: 160px;\n        box-shadow: 0px 8px 16px 0px rgba(0, 0, 0, 0.2);\n        z-index: 1;\n        right: 0;\n      }\n      .dropdown-content a {\n        color: #333;\n        padding: 12px 16px;\n        text-decoration: none;\n        display: block;\n      }\n      .dropdown-content a:hover {\n        background-color: #ddd;\n      }\n      .dropdown:hover .dropdown-content {\n        display: block;\n      }\n      .hero {\n        background-color: #f8f9fa;\n        padding: 4rem 2rem;\n        text-align: left;\n      }\n      .hero h1 {\n        font-size: 3rem;\n        margin-bottom: 1rem;\n      }\n      .hero p {\n        font-size: 1.2rem;\n        margin-bottom: 2rem;\n      }\n      .btn {\n        display: inline-block;\n        background-color: #9013fe;\n        color: #fff;\n        padding: 0.8rem 1.5rem;\n        text-decoration: none;\n        border-radius: 4px;\n        transition: background-color 0.3s ease;\n      }\n      .btn:hover {\n        background-color: #bd10e0;\n        color: #fff; /* Add this line to set button font color to white on hover */\n      }\n      section {\n        padding: 4rem 2rem;\n      }\n      section h2 {\n        font-size: 2rem;\n        margin-bottom: 2rem;\n        color: #9013fe;\n      }\n      .feature {\n        display: flex;\n        flex-wrap: wrap;\n        align-items: center;\n        justify-content: space-between;\n        margin-bottom: 2rem;\n      }\n      .feature img {\n        max-width: 40%;\n        margin-right: 2rem;\n      }\n      .feature-text {\n        flex: 1;\n      }\n      .feature-text h3 {\n        font-size: 1.5rem;\n        margin-bottom: 1rem;\n      }\n      .pricing {\n        display: flex;\n        justify-content: center;\n        margin-bottom: 2rem;\n        flex-wrap: wrap;\n      }\n      .pricing-card {\n        background-color: #fff;\n        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);\n        padding: 2rem;\n        text-align: center;\n        flex: 1 1 300px;\n        margin: 1rem;\n        transition: transform 0.3s ease;\n        border-radius: 10px;\n      }\n      .pricing-card:hover {\n        transform: translateY(-5px);\n      }\n      .pricing-card h3 {\n        font-size: 1.5rem;\n        margin-bottom: 1rem;\n      }\n      .pricing-card p {\n        font-size: 1.2rem;\n        margin-bottom: 1rem;\n      }\n      .pricing-card .price {\n        font-size: 2rem;\n        font-weight: bold;\n        margin-bottom: 1rem;\n      }\n      .pricing-card .btn {\n        margin-top: 1rem;\n      }\n      .video-section {\n        background-color: #f8f9fa;\n        padding: 4rem 2rem;\n        text-align: center;\n      }\n      .video-section h2 {\n        font-size: 2rem;\n        margin-bottom: 2rem;\n        color: #9013fe;\n      }\n      .video-container {\n        position: relative;\n        padding-bottom: 56.25%;\n        height: 0;\n        overflow: hidden;\n        max-width: 800px;\n        margin: 0 auto;\n      }\n      .video-container iframe {\n        position: absolute;\n        top: 0;\n        left: 0;\n        width: 100%;\n        height: 100%;\n      }\n      footer {\n        background-color: #333;\n        color: #fff;\n        padding: 2rem;\n        text-align: center;\n      }\n      footer p {\n        margin-bottom: 1rem;\n      }\n      @media (max-width: 768px) {\n        header {\n          flex-direction: column;\n          align-items: flex-start;\n        }\n        nav ul {\n          flex-direction: column;\n          margin-top: 1rem;\n        }\n        nav ul li {\n          margin-left: 0;\n          margin-bottom: 0.5rem;\n        }\n        .feature {\n          flex-direction: column;\n          text-align: center;\n        }\n        .feature img {\n          max-width: 100%;\n          margin-right: 0;\n          margin-bottom: 1rem;\n        }\n        .pricing {\n          flex-direction: column;\n          align-items: center;\n        }\n        .pricing-card {\n          margin: 1rem 0;\n        }\n      }\n    </style>\n  </head>\n  <body>\n    <header>\n      <a href=\"landing.html\"\n        ><img\n          src=\"http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1711940763864-landing-ai.png\"\n          alt=\"Landing Ai Logo\"\n          height=\"60\"\n      /></a>\n      <nav>\n        <ul>\n          <li><a href=\"/signup\">Signup</a></li>\n          <li><a href=\"#pricing\">Pricing</a></li>\n          <li class=\"dropdown\">\n            <a href=\"#\">Features</a>\n            <div class=\"dropdown-content\">\n              <a href=\"#iteration\">Iteration</a>\n              <a href=\"#prompt-to-ui\">Prompt to UI</a>\n              <a href=\"#no-code\">No Code</a>\n            </div>\n          </li>\n        </ul>\n      </nav>\n    </header>\n    <section class=\"hero\">\n      <h1>Revolutionize Your Landing Page Creation with AI</h1>\n      <p>\n        Landing Ai is a groundbreaking platform that leverages the power of\n        artificial intelligence to generate stunning, optimized landing pages\n        for your business. Say goodbye to the hassle of coding and design, and\n        hello to a seamless, no-code experience that will elevate your online\n        presence.\n      </p>\n      <a href=\"#\" class=\"btn\">Get Started</a>\n    </section>\n    <section>\n      <h2>Pricing</h2>\n      <div id=\"pricing\" class=\"pricing\">\n        <div class=\"pricing-card\">\n          <h3>Basic</h3>\n          <p>Perfect for individuals and small businesses.</p>\n          <p class=\"price\">$49/month</p>\n          <ul>\n            <li>Up to 5 landing pages</li>\n            <li>Basic analytics</li>\n            <li>Limited customization</li>\n          </ul>\n          <a href=\"#\" class=\"btn\">Buy Now</a>\n        </div>\n        <div class=\"pricing-card\">\n          <h3>Pro</h3>\n          <p>For growing businesses and agencies.</p>\n          <p class=\"price\">$79/month</p>\n          <ul>\n            <li>Unlimited landing pages</li>\n            <li>Advanced analytics</li>\n            <li>Custom domain support</li>\n          </ul>\n          <a href=\"#\" class=\"btn\">Buy Now</a>\n        </div>\n        <div class=\"pricing-card\">\n          <h3>Enterprise</h3>\n          <p>For large organizations and enterprises.</p>\n          <p class=\"price\">$99/month</p>\n          <ul>\n            <li>Unlimited landing pages</li>\n            <li>Advanced analytics</li>\n            <li>Custom domain support</li>\n            <li>Priority support</li>\n          </ul>\n          <a href=\"#\" class=\"btn\">Buy Now</a>\n        </div>\n      </div>\n    </section>\n    <section>\n      <h2>Features</h2>\n      <div class=\"feature\">\n        <img\n          src=\"http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1711941027618-undraw_Team_up_re_84ok-(1).png\"\n          alt=\"Iteration\"\n        />\n        <div class=\"feature-text\">\n          <h3 id=\"iteration\">Iteration</h3>\n          <p>\n            With Landing Ai, you can effortlessly iterate and refine your\n            landing page designs. Our AI-powered platform allows you to quickly\n            generate multiple variations, ensuring you find the perfect layout\n            and messaging for your target audience.\n          </p>\n        </div>\n      </div>\n      <div class=\"feature\">\n        <div class=\"feature-text\">\n          <h3 id=\"prompt-to-ui\">Prompt to UI</h3>\n          <p>\n            Our cutting-edge technology transforms your prompts into visually\n            stunning and highly functional user interfaces. Simply provide your\n            requirements, and let Landing Ai work its magic, creating a stunning\n            landing page tailored to your specifications.\n          </p>\n        </div>\n        <img\n          src=\"http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1711941094043-undraw_Mobile_interface_re_1vv9.png\"\n          alt=\"Prompt to UI\"\n        />\n      </div>\n      <div class=\"feature\">\n        <img\n          src=\"http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1711940832024-undraw_Static_website_re_x70h.png\"\n          alt=\"No Code\"\n        />\n        <div class=\"feature-text\">\n          <h3 id=\"no-code\">No Code</h3>\n          <p>\n            Landing Ai's no-code approach empowers you to create\n            professional-grade landing pages without the need for coding skills\n            or extensive design knowledge. Our user-friendly interface ensures a\n            seamless experience, allowing you to focus on your business goals\n            while we handle the technical aspects.\n          </p>\n        </div>\n      </div>\n    </section>\n    <section class=\"video-section\">\n      <h2>Watch Our Demo</h2>\n      <div class=\"video-container\">\n        <iframe\n          width=\"560\"\n          height=\"315\"\n          src=\"https://www.youtube.com/embed/h_XrF3WDAzw\"\n          frameborder=\"0\"\n          allow=\"accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture\"\n          allowfullscreen\n        ></iframe>\n      </div>\n    </section>\n    <footer>\n      <p>&copy; 2023 Landing Ai. All rights reserved.</p>\n      <p>Thank you for visiting Landing Ai.</p>\n    </footer>\n  </body>\n</html>\n\n\nExample Output:\n",
        messages: [
          {
            role: "user",
            content: JSON.stringify(prompt),
          },
        ],
        model: "claude-3-sonnet-20240229",
        max_tokens: 4000,
        temperature: 0.5,
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
