const express = require('express');
const router = express.Router();
const axios = require('axios');
require('dotenv').config();

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const EMAIL_PATTERNS = [
  (f, l, d) => `${f}.${l}@${d}`,
  (f, l, d) => `${f}${l}@${d}`,
  (f, l, d) => `${l}.${f}@${d}`
];

function guessEmail(first, last, domain) {
  return EMAIL_PATTERNS.map(fn => fn(first.toLowerCase(), last.toLowerCase(), domain));
}

async function fallbackPuppeteerSearch(company) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0');

  const url = `https://www.google.com/search?q=${encodeURIComponent(`site:linkedin.com/in "${company}"`)}&num=20`;
  await page.goto(url, { waitUntil: 'networkidle2' });
  await new Promise(res => setTimeout(res, 2000));
  await page.evaluate(() => window.scrollBy(0, window.innerHeight));

  const profiles = await page.$$eval('a', anchors =>
    anchors
      .filter(a => a.href.includes('linkedin.com/in') && a.innerText.trim())
      .map(a => ({ title: a.innerText, link: a.href }))
  );

  await browser.close();
  return profiles;
}

router.post('/', async (req, res) => {
  const { company, companyDomain } = req.body;
  if (!company || !companyDomain) return res.status(400).json({ error: 'Company and domain required' });

  let profiles = [];
  try {
    const serp = await axios.get('https://serpapi.com/search.json', {
      params: { engine: 'google', q: `site:linkedin.com/in "${company}"`, api_key: process.env.SERPAPI_KEY }
    });
    profiles = serp.data.organic_results || [];
  } catch {
    console.warn('SerpAPI error, using fallback...');
  }

  if (!profiles.length) {
    try {
      profiles = await fallbackPuppeteerSearch(company);
    } catch (e) {
      return res.status(500).json({ error: 'Scraping failed' });
    }
  }

  const employees = profiles.map(p => {
    const name = (p.title.match(/^(.+?) -/) || [])[1] || p.title;
    const [first, ...rest] = name.split(' ');
    const last = rest.join('') || '';
    return {
      name,
      title: p.title,
      linkedin: p.link.split('?')[0],
      email: guessEmail(first, last, companyDomain)[0],
    };
  });

  res.json({ employees });
});

module.exports = router;
