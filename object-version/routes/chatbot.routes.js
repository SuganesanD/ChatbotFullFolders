const express = require('express');
const { classifyHandler, askHandler } = require('../controllers/chatbot.controller');

const router = express.Router();

router.post('/classify', classifyHandler);
router.post('/ask', askHandler);

module.exports = router;
