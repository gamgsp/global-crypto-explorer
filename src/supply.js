// Exact money supply calculator based on GSP Coin Core src/validation.cpp GetBlockSubsidy
const PREMINE = 50000000; // 10 * 5,000,000

function getBlockSubsidy(height) {
  if (height < 10) return 5000000;
  if (height < 100000) return 2525;
  if (height < 200000) return 2625;
  if (height < 300000) return 2725;
  if (height < 400000) return 2825;
  if (height < 500000) return 2925;
  if (height < 600000) return 3025;
  if (height < 700000) return 3125;
  if (height < 800000) return 3225;
  if (height < 900000) return 3325;
  if (height < 1000000) return 3425;
  if (height < 1100000) return 3425;
  if (height < 1200000) return 3325;
  if (height < 1300000) return 3225;
  if (height < 1400000) return 3125;
  if (height < 1500000) return 3025;
  if (height < 1600000) return 2925;
  if (height < 1700000) return 2825;
  if (height < 1800000) return 2725;
  if (height < 1900000) return 2625;
  if (height < 2000000) return 2525;
  return 1;
}

// Calculate total money supply up to block height
function calculateMoneySupply(height) {
  if (height <= 0) return 0;
  if (height < 10) return height * 5000000;

  let total = PREMINE; // blocks 0-9

  // Helper to add interval
  function addInterval(start, end, reward) {
    if (height < start) return false;
    const blocks = Math.min(height, end) - start + 1;
    total += blocks * reward;
    return height > end;
  }

  if (!addInterval(10, 99999, 2525)) return total;
  if (!addInterval(100000, 199999, 2625)) return total;
  if (!addInterval(200000, 299999, 2725)) return total;
  if (!addInterval(300000, 399999, 2825)) return total;
  if (!addInterval(400000, 499999, 2925)) return total;
  if (!addInterval(500000, 599999, 3025)) return total;
  if (!addInterval(600000, 699999, 3125)) return total;
  if (!addInterval(700000, 799999, 3225)) return total;
  if (!addInterval(800000, 899999, 3325)) return total;
  if (!addInterval(900000, 999999, 3425)) return total;
  if (!addInterval(1000000, 1099999, 3425)) return total;
  if (!addInterval(1100000, 1199999, 3325)) return total;
  if (!addInterval(1200000, 1299999, 3225)) return total;
  if (!addInterval(1300000, 1399999, 3125)) return total;
  if (!addInterval(1400000, 1499999, 3025)) return total;
  if (!addInterval(1500000, 1599999, 2925)) return total;
  if (!addInterval(1600000, 1699999, 2825)) return total;
  if (!addInterval(1700000, 1799999, 2725)) return total;
  if (!addInterval(1800000, 1899999, 2625)) return total;
  if (!addInterval(1900000, 1999999, 2525)) return total;

  if (height >= 2000000) {
    total += (height - 2000000 + 1) * 1;
  }

  return total;
}

module.exports = {
  getBlockSubsidy,
  calculateMoneySupply,
};
