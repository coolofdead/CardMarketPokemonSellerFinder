const puppeteer = require("puppeteer");
const fs = require('fs');
const readline = require('readline');

const CM_FILTERS_URL = "?language=1,2&minCondition=5";

var cardUrls = [];
var sellers = {};

async function fetchCardsInDeckList() {
    const fileStream = fs.createReadStream('decklist.txt');

    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity // Note: we use the crlfDelay option to recognize all instances of CR LF ('\r\n') in input.txt as a single line break
    });

    for await (const line of rl) {
        let cardLine = line.split(' ');
        cardUrls.push({quantity : parseInt(cardLine[0]), url : cardLine[1]});
    }
}

(async () => {
    // await fetchCardsInDeckList();

    let cardUrls = [{  
        quantity: 2,
        url: 'https://www.cardmarket.com/fr/Pokemon/Products/Singles/Shining-Fates/Crobat-V-SHF44' + CM_FILTERS_URL
    }];

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    // find card sellers infromations
    for (let card of cardUrls) {
        await page.goto(card.url);

        const sellersNames = await page.$$eval('.seller-name a', (sellerNames) => { return sellerNames.map(sellerName => sellerName.textContent);});
        const sellersPrices = await page.$$eval('.price-container', (sellerPrices) => { return sellerPrices.map(sellerPrice => parseFloat(sellerPrice.textContent.replace(',', '.').match(/\d+\.\d{1,2}/i)[0]))});
        const sellersQuantities = await page.$$eval('.item-count', (sellerNames) => { return sellerNames.map(sellerName => parseInt(sellerName.textContent));});

        if (sellersNames.length + sellersPrices.length + sellersQuantities.length != sellersNames.length * 3) {
            console.log('Bug sur les récupérations des informations des vendeurs');
        }

        // register cards for each sellers
        sellersNames.forEach((sellerName, index) => {
            let sellerPrice = sellersPrices[index];
            let sellerQuantity = sellersQuantities[index] >= card.quantity ? card.quantity : sellersQuantities[index];
            
            // sellers[]
            if (sellers[sellerName] == undefined)
                sellers[sellerName] = {sellerName: '', totalQuantity: 0, totalPrice: 0, cards : []};
            sellers[sellerName].cards.push({quantity : sellerQuantity, price : sellerPrice, card : card.url});
            sellers[sellerName].totalQuantity += sellerQuantity;
            sellers[sellerName].totalPrice += sellerPrice;
            sellers[sellerName].sellerName = sellerName;
        });

        await page.waitForTimeout(1000);
    }

    sellers = Object.values(sellers).sort(function(a,b) {
        return a.totalQuantity == b.totalQuantity ? a.totalPrice - b.totalPrice : b.totalQuantity - a.totalQuantity;
    });
    sellers = sellers.slice(0, -40); // take only the 10 best sellers
    
    sellers.forEach((seller, index) => {
        let fileContent = seller['sellerName'] + "\n";
        fileContent += "total_quantite," + seller['totalQuantity'] + "\n";
        fileContent += "total_prix," + seller['totalPrice'] + "\n";
        fileContent += "cards\n";
        seller.cards.forEach(cardInfo => {
            fileContent += cardInfo.card + "\n";
        });

        fs.writeFileSync(`./seller_number_${index}.csv`, fileContent);
    });
    await browser.close();

  })();