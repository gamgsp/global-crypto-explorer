const fs = require('fs');
const path = require('path');
const CLAIMS_FILE = path.join(__dirname, '../data/claims.json');

function loadClaims() {
  try {
    if (fs.existsSync(CLAIMS_FILE)) {
      return JSON.parse(fs.readFileSync(CLAIMS_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveClaims(claims) {
  try {
    fs.writeFileSync(CLAIMS_FILE, JSON.stringify(claims, null, 2), 'utf8');
  } catch (e) {}
}

function getClaim(address) {
  const claims = loadClaims();
  return claims.find(c => c.address === address) || null;
}

function getAllClaims() {
  return loadClaims();
}

function addClaim(address, claim_name, message, signature) {
  let claims = loadClaims();
  claims = claims.filter(c => c.address !== address);
  claims.unshift({
    address,
    claim_name,
    message,
    signature,
    claimed_at: Math.floor(Date.now() / 1000),
  });
  saveClaims(claims);
}

module.exports = {
  getClaim,
  getAllClaims,
  addClaim,
};
