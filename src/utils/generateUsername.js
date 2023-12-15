function generateUniqueUsername() {
  const prefix = "user_";
  const randomNumber = Math.floor(1000000000 + Math.random() * 9000000000); // Generate a random 10-digit number

  // You can add a timestamp or a random string for extra uniqueness
  const uniqueUsername = `${prefix}${randomNumber}`;

  return uniqueUsername;
}

module.exports = generateUniqueUsername;
