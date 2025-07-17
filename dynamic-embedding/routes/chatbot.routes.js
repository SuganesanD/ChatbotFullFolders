const express = require('express');
const { askHandler } = require('../controllers/chatbot.controller');

const router = express.Router();

router.post('/ask', askHandler);

module.exports = router;
