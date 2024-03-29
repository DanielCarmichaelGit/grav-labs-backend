const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
const upload = multer({ dest: 'uploads/' });

// Connect to MongoDB
mongoose.connect('mongodb://localhost/your_database', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

app.get("/", async (req, res) => {
  res.status(200).json({
    message: "working"
  })
})

// Anthropic API endpoint
app.post('/api/anthropic', async (req, res) => {
  const { message } = req.body;

  try {
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const response = await anthropic.completions.create({
      model: "claude-3-opus-20240229",
      max_tokens: 4000,
      temperature: 0,
      prompt: `Objective: \nIngest an object which will look similar to the following:\n\n{website_title: "Kamari", theme: "dark", colors: {primary: "#9013FE", secondary: "#BD10E0", tertiary: "#FF5555"}, header: {signup: "/signup", pricing: "/pricing", features: {Invoicing: "#invoicing", client_management: "#client-management", time_tracking: "#time-tracking"}}, copy: "Kamari teams is a time tracking, task management, and invoicing tool, designed for freelancers. Freelancers can invite clients, track time against tasks, send invoices for hours worked, and clients can closely manage their product pipeline via task management. Kamari teams partners with stripe to bring invoicing to every freelancer. Kamari teams takes no portion of the money earned... no platform fees ever! Get started for free with no credit card required. Don\'t like it? No commitment."}\n\nEach feature in the features dropdown should have its own section on thee landing page. Clicking on the feature in the feature dropdown should scroll the user the the position of the features section. Additional sections should be added to the landing page that are found within the copy of the input. Images should be added to the landing page where necessary, such as for each feature, in the header (logo) and in the footer (logo).\n\nTone:\nThe tone of the application should be friendly and jovial but remain professional and be as accurate and frank as possible with the responses.\n\nRules:\nThe output should not use global css definitions. It should use inline css. \n\nThe output landing page should be seo optimized using the latest seo trends.\n\nEnsure that the end user does not have to scroll at first to see some initial content. There should be a top section that is displayed after the page load.\n\nThe output should also have an object of required images. {header_logo: "", footer_logo: "", feature_invoicing: ""...}. The landing page that is generated should be react and should have all function definitions within the same output.\n\nThe output landing page should have a max header height of 60px unless specified within thee input object with the "header_height" key. \n\nThe initial content of the page should take up the entire height and width of the page and all other content should be found only when the user scrolls down. \n\nThe content that is found only when the user scrolls should load in on scroll.\n\nThe dropdown in the header should trigger on hover and should have styles similar to the other buttons but should contain a chevron to indicate it is a drop down. Again, this is very important. Any dropdown within the header or found within the landing page should be triggered on hover.\n\nEach button should have a outline: none on focus. \n\nAdd copy to ensure the page feels full of content. The input will include an "industry" key which will be a string. Additional copy should be derived from industry competition. \n\nThe input object will include "alignment" key that indicates if the copy should be aligned left, center, or right.\n\nThe input may include a "staggered" key which if it is true, the features should stagger from text aligned left to aligned right.\n\nThe header should be vertically aligned so each item is centered vertically.\n\nThe initial content should have an image within it. \n\nThe initial copy should not be the entire copy string but should be the key points of the copy string/should be derived from the copy.\n\nInput:\n${message}`,
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});

// Image upload endpoint
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded' });
  }

  // Process the uploaded image
  // ...

  res.json({ message: 'Image uploaded successfully' });
});

// Start the server
const port = process.env.PORT || 6000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});