const {
    MemoryAccount,
    Channel,
    Crypto,
    Universal,
    TxBuilder
} = require('@aeternity/aepp-sdk');

const {
    API_URL,
    INTERNAL_API_URL,
    STATE_CHANNEL_URL,
    NETWORK_ID,
    RESPONDER_HOST,
    RESPONDER_PORT
} = require('./../config/nodeConfig');

const keyPair = require('./../config/keyPair');
const products = require('./../config/products');

let openChannels = new Map();

let createAccount = async function (keyPair) {
    let tempAccount = await Universal({
        networkId: NETWORK_ID,
        url: API_URL,
        internalUrl: INTERNAL_API_URL,
        keypair: {
            publicKey: keyPair.publicKey,
            secretKey: keyPair.secretKey
        }
    })

    return tempAccount;
}

// console.log('TxBuilder');
// console.log(TxBuilder);

let account;

(async function() { 
    account = await createAccount(keyPair);
})()

async function createChannel(req, res) {

    let params = req.body.params;
    params.channelReserve = parseInt(params.initiatorAmount * 0.25);

    //console.log('init params:', params);

    let channel = await connectAsResponder(params);
    let data = {
        channel,
        round: 1,
        product: {
            name: '',
            price: 0
        },
        isSigned: true
    }

    openChannels.set(params.initiatorId, data);

    channel.sendMessage('State channel is successfully created!', params.initiatorId);

    res.send('ok');
}

async function connectAsResponder(params) {
    return await Channel({
        ...params,
        url: STATE_CHANNEL_URL,
        role: 'responder',
        sign: responderSign
    })
}

async function responderSign(tag, tx) {
    console.log('==> responder sign tag:', tag);

    if (tag === 'responder_sign') {
        return account.signTransaction(tx)
    }

    // Deserialize binary transaction so we can inspect it
    //const txData = Crypto.decodeTx(tx);
    // console.log('=====> aa');
    // console.log(Crypto);
    // console.log();
    // console.log(txData);

    
    //const txData = Crypto.decode(Crypto.decodeTx(tx));
    const txData = TxBuilder.unpackTx(tx);

    console.log();
    console.log();
    console.log();
    console.log('----> txData');
    console.log(txData);

    //console.log('==> txData <==')
    //console.log(txData);

    // When someone wants to transfer a tokens we will receive
    // a sign request with `update_ack` tag
    if (tag === 'update_ack') {

        let isValid = isTxValid(txData);
        if (!isValid) {
            // TODO: challenge/dispute
        }

        // Check if update contains only one offchain transaction
        // and sender is initiator
        if (txData.tag === 'CHANNEL_OFFCHAIN_TX' && isValid) {
            sendConfirmMsg(txData);
            return account.signTransaction(tx);
        }
    }

    if (tag === 'shutdown_sign_ack') {

        //console.log(txData);

        if (
            txData.tag === 'CHANNEL_CLOSE_MUTUAL_TX'
        ) {
            return account.signTransaction(tx);
        }
    }
}

function isTxValid (txData) {

    let lastUpdateIndex = txData.updates.length - 1;
    if (lastUpdateIndex < 0) {
        console.log('==> last index is smaller than 0')
        return false;
    }

    let lastUpdate = txData.updates[lastUpdateIndex];
    let data = openChannels.get(lastUpdate.from);
    if (!data) {
        console.log('==> no data <==')
        return false;
    }
    
    let isRoundValid = data.round === txData.round;
    let isPriceValid = data.product.price === txData.updates[lastUpdateIndex].amount;
    let isValid = isRoundValid && isPriceValid;
    if (isValid) {
        openChannels[lastUpdate.from].isSigned = true;
    }

    return isValid;
}

function sendConfirmMsg (txData) {
    let from = txData.updates[txData.updates.length - 1].from;
    let data = openChannels.get(from);
    let msg = `Successfully bought ${data.product.name} for ${data.product.price} ae.`;
    data.channel.sendMessage(msg, from);
}

async function buyProduct(req, res) {

    let initiatorAddress = req.body.initiatorAddress;
    let productName = req.body.productName;

    let productPrice = products[productName];
    let data = openChannels.get(initiatorAddress);

    if (productPrice && data && data.isSigned) {

        data.round++;
        data.product = {
            name: productName,
            price: productPrice
        }
        data.isSigned = false;

        openChannels[initiatorAddress] = data;

        res.send({
            price: productPrice
        });
    } else {
        res.status(404);
        res.end();
    }
}

function stopChannel(req, res) {
    let result = openChannels.delete(req.body.initiatorAddress);

    res.send(result);
}

module.exports = {
    post: {
        createChannel,
        buyProduct,
        stopChannel
    }
}