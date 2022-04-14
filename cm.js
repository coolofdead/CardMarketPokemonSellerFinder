const puppeteer = require("puppeteer");
const fs = require('fs');
const readline = require('readline');

const CM_FILTERS_URL = "?language=1,2&sellerType=1,2";
const CM_MAX_LOAD_MORE_CLICK = 15;

var sellers = {};

async function fetchCardsInDeckList() 
{
    const decklistFileStream = fs.createReadStream('decklist.txt');
    let cardUrls = [];

    const deckListRl = readline.createInterface({
        input: decklistFileStream,
        crlfDelay: Infinity // Note: we use the crlfDelay option to recognize all instances of CR LF ('\r\n') in input.txt as a single line break
    });
    
    for await (const line of deckListRl) {
        let cardLine = line.split(' ');
        let cardQuantityFoundInSellers = 0;
        
        const sellersFileStream = fs.createReadStream('sellers.csv');
        const sellersRl = readline.createInterface({
            input: sellersFileStream,
            crlfDelay: Infinity // Note: we use the crlfDelay option to recognize all instances of CR LF ('\r\n') in input.txt as a single line break
        });
        
        for await (const sellerLine of sellersRl) {
            // TODO : Change to change quantity or simply skip card
            if (sellerLine.includes(cardLine[1])) {
                cardQuantityFoundInSellers += parseInt(sellerLine.charAt(sellerLine.length - 1));
            } 
        }
        
        sellersRl.close();
        sellersFileStream.close();

        let cardQuantity = parseInt(cardLine[0]) - cardQuantityFoundInSellers;
        if (cardQuantity > 0) {
            cardUrls.push({quantity : cardQuantity, url : cardLine[1]});
        }
    }

    deckListRl.close();

    decklistFileStream.close();
    
    return cardUrls;
}

async function fetchSellersFromCm(card, page) 
{
    let sellersSeenThisPage = [];

    // find card sellers infromations
    console.log(card.url);
    
    await page.goto(card.url + CM_FILTERS_URL);

    let nbClickLoadMore = 0;
    while (await page.$('#loadMoreButton') != null && nbClickLoadMore < CM_MAX_LOAD_MORE_CLICK)
    {
        await page.click('#loadMoreButton');
        nbClickLoadMore++;
    }

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
        
        if (sellersSeenThisPage.includes(sellerName))
            return;

        // sellers dosen't exist yet
        if (sellers[sellerName] == undefined)
            sellers[sellerName] = {sellerName: '', totalQuantity: 0, totalPrice: 0, cards : []};
        sellers[sellerName].cards.push({quantity : sellerQuantity, price : sellerPrice, card : card.url});
        sellers[sellerName].totalQuantity += sellerQuantity;
        sellers[sellerName].totalPrice += sellerPrice;
        sellers[sellerName].sellerName = sellerName;

        sellersSeenThisPage.push(sellerName);
    });
}

async function saveBestSeller(seller)
{
    let fileContent = fs.readFileSync('./sellers.csv');
    fileContent += ",\n" + seller['sellerName'] + "\n";
    fileContent += "total_quantite," + seller['totalQuantity'] + "\n";
    fileContent += "total_prix," + seller['totalPrice'] + "\n";
    fileContent += "cards\n";
    seller.cards.forEach(cardInfo => {
        fileContent += cardInfo.card + "," + cardInfo.price + "," + cardInfo.quantity + "\n";
    });
    
    fs.writeFileSync(`./sellers.csv`, fileContent);
}

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    let cardUrls = await fetchCardsInDeckList();
    
    // let cardUrls = [{  
    //     quantity: 2,
    //     url: 'https://www.cardmarket.com/fr/Pokemon/Products/Singles/Brilliant-Stars/Ultra-Ball-V1-BRS150' + CM_FILTERS_URL
    // }];

    while (cardUrls.length > 0)
    {
        for (let card of cardUrls)
        {
            await fetchSellersFromCm(card, page);
            await page.waitForTimeout(1000);
        }

        sellers = Object.values(sellers).sort(function(a,b) {
            return a.totalQuantity == b.totalQuantity ? a.totalPrice - b.totalPrice : b.totalQuantity - a.totalQuantity;
        });
    
        await saveBestSeller(sellers[0]);
        sellers = {};

        cardUrls = await fetchCardsInDeckList();
    }

    await browser.close();

  })();