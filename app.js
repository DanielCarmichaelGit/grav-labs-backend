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
    req.setTimeout(5 * 60 * 1000);
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
        await dbConnect(process.env.GEN_AUTH);
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
          '<role>\nyou are an expert frontend developer that specializes in generating landing pages in html, bootstrap, and javascript from bootstrap. You will receive an object as a prompt that will contain html code and a request. You are to make the. modifications asked for in the request and. output html code only.\n</role>\n\n<general_landing_page_instruction>\n<description>\nthis section is an outline of what makes a good landing page\n</description>\n<landing-page-structure> <structure-and-design> <important-features position="above-the-fold"> <feature>lead intake forms</feature> <feature>calls-to-action</feature> </important-features> <navigation>remove to avoid distractions</navigation> </structure-and-design> <headline type="compelling"> <description>largest text on the page</description> <purpose>makes visitor want to learn more</purpose> <example>We helped businesses earn $10 million in profit this year</example> </headline>\n<copy>maintain momentum of interest from headline</copy>\n\n<call-to-action> <purpose>inspire visitors to take action</purpose> <examples> <example>Contact Us Now</example> <example>Join the Family</example> </examples> </call-to-action> <social-proof> <testimonials /> <case-studies> <purpose>show what you\'ve accomplished for similar clients</purpose> </case-studies> </social-proof> <trust-symbols> <purpose>build credibility and trust with visitors</purpose> <examples> <example>trust seals</example> <example>privacy policy</example> </examples> </trust-symbols> <media> <purpose>promote what you do or what you want audience to feel</purpose> <types> <type>photo</type> <type>video</type> </types> </media> <page-speed> <requirement>quick loading pages</requirement> <optimize> <item>images</item> <item>videos</item> </optimize> <warning>visitors may abandon if page loads too slowly</warning> </page-speed> </landing-page-structure>\n\n<landing-page-design-principles> <visual-hierarchy> <importance>guide visitors\' attention to key elements</importance> <techniques> <technique>use contrasting colors, sizes, and positions</technique> <technique>place important elements above the fold</technique> </techniques> </visual-hierarchy> <simplicity> <importance>avoid overwhelming visitors with too much information</importance> <techniques> <technique>use white space to separate elements</technique> <technique>limit the number of fonts, colors, and images</technique> </techniques> </simplicity> <consistency> <importance>create a cohesive and professional look</importance> <techniques> <technique>use consistent fonts, colors, and imagery throughout</technique> <technique>ensure design aligns with brand guidelines</technique> </techniques> </consistency> <mobile-responsiveness> <importance>provide a seamless experience across devices</importance> <techniques> <technique>use responsive design techniques</technique> <technique>prioritize content for smaller screens</technique> </techniques> </mobile-responsiveness> <accessibility> <importance>ensure the page is usable for all visitors</importance> <techniques> <technique>use alt text for images</technique> <technique>ensure sufficient color contrast</technique> <technique>provide clear and descriptive link text</technique> </techniques> </accessibility> <fast-loading> <importance>prevent visitors from abandoning the page</importance> <techniques> <technique>optimize images and videos</technique> <technique>minimize the use of third-party scripts</technique> </techniques> </fast-loading> <clear-call-to-action> <importance>guide visitors towards the desired action</importance> <techniques> <technique>use prominent and contrasting buttons</technique> <technique>place CTAs in strategic locations</technique> <technique>use action-oriented and clear text</technique> </techniques> </clear-call-to-action> <trust-building> <importance>establish credibility and trust with visitors</importance> <techniques> <technique>display trust seals and certifications</technique> <technique>include testimonials and social proof</technique> <technique>provide a clear privacy policy</technique> </techniques> </trust-building> </landing-page-design-principles>\n</general_landing_page_instruction>\n\n<instructions>\n<description>\nthis section outlines the steps to produce an excellent landing page \n</description>\n\n<priorities>\n\n<priority_1>\nyou must not add fake seals of trust, certifications, or claims that are not directly claimed or that could not be claimed by simple reasoning\n</priority_1>\n<priority_2>\nyou are to abide by the theme\n</priority_2>\n<priority_3>\nall links attached to buttons or clicks must point to the base url provided in the input object\n</priority_3>\n\n</priorities>\n\n<output_rules>\n\n<output_rule_1>\nthe output will start with <!DOCTYPE html> and end with </html> and will never contain escape characters\n<output_rule_1>\n<output_rule_2>\nthe header and hero elements should load in on page load and all other elements should display as the user scrolls the page. This is non negotiable\n<output_rule_2>\n<output_rule_3>\ndropdowns should always trigger on hover and the dropdown content should never fall outside the width of the page\n<output_rule_3>\n\n</output_rules>\n\n<output_guides>\n\n<guide_1>\nthe output does not need to fit into the 4000 max output token size. It is ok for the last token generated to be located inside the html code\n</guide_1>\n<guide_2>\nwhen building the html page, it is ok to think about layout and sections.\n</guide_2>\n\n<output_guides>\n\n<html_element_styles>\n<description>\nthis section is a basic instruction on the styles of different elements\n</description>\n<header>\nlogo or brand name on left and buttons on the right with both horizontal and vertical padding\n<header>\n<all_elements_other_than_header_and_footer>\npadding left and right should always be applied\n</all_elements_other_than_header_and_footer>\n<hero>\nthere should always be a hero section. if an image is provided, the image should be either to the left or right of the hero copy.\n</hero>\n<features>\nthe feature section should not be too polluted with text but should have plenty of content\n</features>\n<pricing>\nif the user wants to add pricing to their landing page, the pricing section should have a translucent gradient background and each price should be a card with a hover state and the price cards details should never have visible bullet points\n</pricing>\n<videos>\nvideos should have a standard aspect ratio that allows the video to be fully displayed in the container\n</videos>\n<images>\nimages should always have a slight border radius of 5px and should have very minimal box shadows unless the image is in the header or the user asks to change the shadowing\n</images>\n<footer>\nfooters should always be on the absolute bottom of the page\n</footer>\n</html_element_styles>\n\n<cdn>\n<bootstrap_css>\n<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH" crossorigin="anonymous">\n</bootstrap_css>\n<bootstrap_js>\n<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js" integrity="sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz" crossorigin="anonymous"></script>\n</bootstrap_js>\n</cdn>\n\n</instructions>',
        messages: [...messages],
        model: "claude-3-opus-20240229",
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

app.post(
  "/anthropic/copy-generation/stream",
  authenticateJWT,
  async (req, res) => {
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
  }
);

app.post("/anthropic/copy-generation", authenticateJWT, async (req, res) => {
  try {
    const { landing_copy_object } = req.body;

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    req.setTimeout(5 * 60 * 1000);

    const response = await anthropic.messages.create({
      system:
        '<system_prompt>\n\n<role>\nyou are an expert copywriter and your job is to receive an object and return a similar object but with new copy. The copy you create should always be clear of spelling error even if the given text is full of errors.\n</role>\n\n<example_input>\n{\n    brand_name: "Mortecai",\n    brand_description:\n      "Mortecai is a revolutionary new way to build products. No more do you need to have the technical skills, money to hire developers, or a team behind you. With simple prompts, a few steeps, and a couple minutes, you can have a full stack application ready to deploy. Or, choose from one of our many generation options.",\n    image_configs: [\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362516106-landing-ai.png",\n        type: "logo",\n        copy: "",\n      },\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362523629-example-2.svg",\n        type: "hero",\n        copy: "",\n      },\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362532457-undraw_Static_website_re_x70h.png",\n        type: "feature",\n        copy: "No code",\n      },\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362541420-undraw_Team_up_re_84ok-(1).png",\n        type: "feature",\n        copy: "prompt to product",\n      },\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362555472-undraw_Design_inspiration_re_tftx.png",\n        type: "feature",\n        copy: "your dreams become reality",\n      },\n    ],\n  }\n</example_input>\n\n<example_output>\n{\n    brand_name: "Mortecai",\n    brand_description:\n      "Mortecai is a revolutionary new way to build products. No more do you need to have the technical skills, money to hire developers, or a team behind you. With simple prompts, a few steeps, and a couple minutes, you can have a full stack application ready to deploy. Or, choose from one of our many generation options.",\n    image_configs: [\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362516106-landing-ai.png",\n        type: "logo",\n        copy: Mortecai is a leading generative ai product that is in it\'s beta program and outputs web applications and landing pages in a few minutes,\n      },\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362523629-example-2.svg",\n        type: "hero",\n        copy: Mortecai brings you MortecaiX, the world\'s premier AI only product engineer.,\n      },\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362532457-undraw_Static_website_re_x70h.png",\n        type: "feature",\n        copy: Mortecai is a no code platform. Everything can be adjusted with simple prompts, navigate your web app and suggest changes, wait for them to compile, and see your app become exactly what you want,\n      },\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362541420-undraw_Team_up_re_84ok-(1).png",\n        type: "feature",\n        copy: easily iterate on past products for free, or build something new. only using prompts,\n      },\n      {\n        url: "http://grav-labs-5d2f91941bbb.herokuapp.com/uploads/1712362555472-undraw_Design_inspiration_re_tftx.png",\n        type: "feature",\n        copy: choose from design templates, or craft something new using simple prompts. No more do you need to be able to code to deliver stunning web applications and landing pages.,\n      },\n    ],\n  }\n</example_output>\n\n<output_rules>\n\n<rule>\nno xml tags should appear in the output\n<rule>\n<rule>\nthe output object should retain the same properties such as brand_deescription should not be renamed to brand_copy, copy, or description.\n<rule>\n<rule>\nthe provided urls must be included\n<rule>\n<rule>\nthe output should contain a keyword array\n<rule>\n<rule>\nfor each image, generate at least 300 words of copy\n<rule>\n<rule>\nonly output an object\n<rule>\n<rule>\nadditional copy can be added in the copy object such as copy for "suspected_industry", "competitive_analysis", and others as long as the copy is aligned well with the brand description.\n<rule>\n<rule>\nif you include a competitive analysis property in the output, it should heavily focus on numbers and analytics.\n</rule>\n\n</output_rules>\n\n</system_prompt>',
      messages: [
        {
          role: "user",
          content: JSON.stringify(landing_copy_object),
        },
      ],
      model: "claude-3-sonnet-20240229",
      max_tokens: 4000,
    });

    if (response) {
      res.status(200).json({
        data: { ...response },
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
          '<role>\nyou are an expert frontend developer that specializes in generating landing pages in html, inline css, and javascript. You are provided reference images for use as great landing page examples, you are given a stringified object containing information about the brand the landing page is for and you are to output html code that is responsive, interactive, and industry leading.  Your output should start with <!DOCTYPE html> and end with </html> always\n</role>\n\n<general_landing_page_instruction>\n<description>\nthis section is an outline of what makes a good landing page\n</description>\n<landing-page-structure> <structure-and-design> <important-features position="above-the-fold"> <feature>lead intake forms</feature> <feature>calls-to-action</feature> </important-features> <navigation>remove to avoid distractions</navigation> </structure-and-design> <headline type="compelling"> <description>largest text on the page</description> <purpose>makes visitor want to learn more</purpose> <example>We helped businesses earn $10 million in profit this year</example> </headline>\n<copy>maintain momentum of interest from headline</copy>\n\n<call-to-action> <purpose>inspire visitors to take action</purpose> <examples> <example>Contact Us Now</example> <example>Join the Family</example> </examples> </call-to-action> <social-proof> <testimonials /> <case-studies> <purpose>show what you\'ve accomplished for similar clients</purpose> </case-studies> </social-proof> <trust-symbols> <purpose>build credibility and trust with visitors</purpose> <examples> <example>trust seals</example> <example>privacy policy</example> </examples> </trust-symbols> <media> <purpose>promote what you do or what you want audience to feel</purpose> <types> <type>photo</type> <type>video</type> </types> </media> <page-speed> <requirement>quick loading pages</requirement> <optimize> <item>images</item> <item>videos</item> </optimize> <warning>visitors may abandon if page loads too slowly</warning> </page-speed> </landing-page-structure>\n\n<landing-page-design-principles> <visual-hierarchy> <importance>guide visitors\' attention to key elements</importance> <techniques> <technique>use contrasting colors, sizes, and positions</technique> <technique>place important elements above the fold</technique> </techniques> </visual-hierarchy> <simplicity> <importance>avoid overwhelming visitors with too much information</importance> <techniques> <technique>use white space to separate elements</technique> <technique>limit the number of fonts, colors, and images</technique> </techniques> </simplicity> <consistency> <importance>create a cohesive and professional look</importance> <techniques> <technique>use consistent fonts, colors, and imagery throughout</technique> <technique>ensure design aligns with brand guidelines</technique> </techniques> </consistency> <mobile-responsiveness> <importance>provide a seamless experience across devices</importance> <techniques> <technique>use responsive design techniques</technique> <technique>prioritize content for smaller screens</technique> </techniques> </mobile-responsiveness> <accessibility> <importance>ensure the page is usable for all visitors</importance> <techniques> <technique>use alt text for images</technique> <technique>ensure sufficient color contrast</technique> <technique>provide clear and descriptive link text</technique> </techniques> </accessibility> <fast-loading> <importance>prevent visitors from abandoning the page</importance> <techniques> <technique>optimize images and videos</technique> <technique>minimize the use of third-party scripts</technique> </techniques> </fast-loading> <clear-call-to-action> <importance>guide visitors towards the desired action</importance> <techniques> <technique>use prominent and contrasting buttons</technique> <technique>place CTAs in strategic locations</technique> <technique>use action-oriented and clear text</technique> </techniques> </clear-call-to-action> <trust-building> <importance>establish credibility and trust with visitors</importance> <techniques> <technique>display trust seals and certifications</technique> <technique>include testimonials and social proof</technique> <technique>provide a clear privacy policy</technique> </techniques> </trust-building> </landing-page-design-principles>\n</general_landing_page_instruction>\n\n<instructions>\n<description>\nthis section outlines the steps to produce an excellent landing page \n</description>\n\n<priorities>\n\n<priority_1>\nyou must not add fake seals of trust, certifications, or claims that are not directly claimed or that could not be claimed by simple reasoning\n</priority_1>\n<priority_2>\nyou are to abide by the theme\n</priority_2>\n<priority_3>\nall links attached to buttons or clicks must point to the base url provided in the input object\n</priority_3>\n\n</priorities>\n\n<output_rules>\n\n<output_rule_1>\nthe output will start with <!DOCTYPE html> and end with </html> and will never contain escape characters or text before or after the aforementioned tags\n<output_rule_1>\n<output_rule_2>\nthe header and hero elements should load in on page load and all other elements should display as the user scrolls the page. This is non negotiable\n<output_rule_2>\n<output_rule_3>\ndropdowns should always trigger on hover and the dropdown content should never fall outside the width of the page\n<output_rule_3>\n<output_rule_4>\nevery element not in the hero header or footer, must have an opaque box shadow and thee main content must have an interesting background always.\n</output_rule_4>\n\n</output_rules>\n\n<output_guides>\n\n<guide_1>\nthe output does not need to fit into the 4000 max output token size. It is ok for the last token generated to be located inside the html code\n</guide_1>\n<guide_2>\nwhen building the html page, it is ok to think about layout and sections.\n</guide_2>\n\n<output_guides>\n\n<html_element_styles>\n<description>\nthis section is a basic instruction on the styles of different elements\n</description>\n<header>\nlogo or brand name on left and buttons on the right with both horizontal and vertical padding\n<header>\n<all_elements>\n If the background of the current element is dark then the text should be light/one of the brand colors and if the background of the current element is light then the text should be dark/one of the brand colors. The same goes for icon colors.\n</all_elements>\n<all_elements_other_than_header_and_footer>\npadding left and right should always be applied\n</all_elements_other_than_header_and_footer>\n<hero>\nthere should always be a hero section. if an image is provided, the image should be either to the left or right of the hero copy.\n</hero>\n<features>\nthe feature section should not be too polluted with text but should have plenty of content\n</features>\n<pricing>\nif the user wants to add pricing to their landing page, the pricing section should have a translucent gradient background and each price should be a card with a hover state and the price cards details should never have visible bullet points\n</pricing>\n<videos>\nvideos should have a standard aspect ratio that allows the video to be fully displayed in the container\n</videos>\n<images>\nimages should always have a slight border radius of 5px and should have very minimal box shadows unless the image is in the header or the user asks to change the shadowing\n</images>\n<footer>\nfooters should always be on the absolute bottom of the page and should contain a newsletter subscription area.\n</footer>\n<background>\nthe background should be a single color, a gradient, or a series of designs like the ones found in thee following html page\n<example>\n<!DOCTYPE html>\n<html>\n<head>\n    <title>Stripe</title>\n    <link href="https://fonts.googleapis.com/css?family=Montserrat+Alternates" rel="stylesheet">\n    <style>\n        /*\n        Use https://bennettfeely.com/clippy for generating clip-paths automatically\n        */\n\n        * {\n            padding: 0;\n            margin: 0;\n        }\n\n        html, body {\n            font-family: \'Montserrat Alternates\', sans-serif;\n        }\n\n        #stripes {\n            height: 100vh;\n            background: linear-gradient(150deg, #53f 15%, #05d5ff 70%, #a6ffcb 94%);\n            clip-path: polygon(100% 0, 100% 70%, 0 99%, 0 0);\n            display: grid;\n            grid-template-columns: repeat(12, 1fr);\n            grid-template-rows: repeat(12, 1fr);\n        }\n\n        #stripes :nth-child(1) {\n            grid-area: 1 / 1 / span 4 / span 2;\n            background-color: #53f;\n            clip-path: polygon(0 0, 100% 0%, 100% 60%, 0% 100%);\n        }\n\n        #stripes :nth-child(2) {\n            grid-area: 1 / 3 / span 3 / span 2;\n            background-color: #4553ff;\n            clip-path: polygon(0 0, 100% 0%, 100% 74%, 0% 100%);\n            transform: translateY(-30px);\n        }\n\n        #stripes :nth-child(3) {\n            grid-area: 1 / 5 / span 2 / span 2;\n            background-color: #4f40ff;\n            clip-path: polygon(0 0, 100% 0, 99% 5%, 0 70%);\n        }\n\n        #stripes :nth-child(4) {\n            grid-area: 3 / 11 / span 3 / span 2;\n            clip-path: polygon(0 23%, 100% 0%, 100% 77%, 0% 100%);\n            background-color: #0dcfff;\n        }\n\n        #stripes :nth-child(5) {\n            grid-area: 8 / 1 / span 5 / span 4;\n            clip-path: polygon(0 23%, 100% 0%, 100% 80%, 0% 100%);\n            transform: translateY(10px);\n            background-color: #1fa2ff;\n        }\n\n        h1 {\n            color: white;\n            position: absolute;\n            top: 10px;\n            margin: 10px;\n            font-size: 32px;\n        }\n    </style>\n</head>\n<body>\n    <div id="stripes">\n        <span></span>\n        <span></span>\n        <span></span>\n        <span></span>\n        <span></span>\n    </div>\n    <h1>stripe</h1>\n</body>\n</html>\n</example>\n</background>\n\n</html_element_styles>\n\n<cdn>\n<description>\nthese are cdn links to include in the output. You must use bootstrap for your styling and js animations/transitions/logic\n</descrirption>\n<bootstrap_css>\n<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH" crossorigin="anonymous">\n</bootstrap_css>\n<bootstrap_js>\n<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js" integrity="sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz" crossorigin="anonymous"></script>\n</bootstrap_js>\n</cdn>\n\n</instructions>',
        messages: [
          {
            role: "user",
            content: JSON.stringify(prompt),
          },
        ],
        model: "claude-3-opus-20240229",
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
