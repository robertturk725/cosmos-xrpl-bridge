const express = require("express");
const bodyParser = require('body-parser');
const mysql = require('mysql2');

const { SigningCosmWasmClient } = require('@cosmjs/cosmwasm');
const { XrplClient } = require('xrpl-client');

const PORT = process.env.PORT || 5000;

const pool = mysql.createPool({
  host: 'my-rds-host',
  user: 'my-user',
  password: 'my-password',
  database: 'my-database',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const cosmosClient = new SigningCosmWasmClient('http://localhost:1317', 'my-mnemonic');
const xrplClient = new XrplClient('https://s.altnet.rippletest.net:51234');

app.post('/transfer', async (req, res) => {
  const { from, to, amount, asset, destinationTag } = req.body;

  // Transfer assets from Cosmos to XRPL
  const response = await cosmosClient.execute(from, { transfer: { recipient: to, amount: [{ amount, denom: asset }] } });
  const txHash = response.transactionHash;

  // Submit a transaction to the XRPL to create a new payment
  const payment = {
    source: {
      address: from,
      maxAmount: {
        value: amount.toString(),
        currency: asset,
      },
    },
    destination: {
      address: to,
      tag: destinationTag,
      amount: {
        value: amount.toString(),
        currency: asset,
      },
    },
  };
  const xrplTx = await xrplClient.submitAndWait(payment);

  // Return the transaction hash to the client
  res.status(200).send({ txHash, xrplTx });
});

app.get('/status', async (req, res) => {
  try {
    // Check the status of the Cosmos network
    const cosmosStatus = await cosmosClient.getStatus();

    // Check the status of the XRPL network
    const xrplStatus = await xrplClient.getLedgerVersion();

    // Return the status information to the client
    res.status(200).send({ cosmos: cosmosStatus, xrpl: xrplStatus });
  } catch (error) {
    // Return an error message to the client if something went wrong
    res.status(500).send({ error: error.message });
  }
});

app.post('/refund', async (req, res) => {
  try {
    const { transactionHash, network } = req.body;

    let refundTxHash;
    if (network === 'cosmos') {
      // Refund the transaction on the Cosmos network
      refundTxHash = await cosmosClient.refund(transactionHash);
    } else if (network === 'xrpl') {
      // Refund the transaction on the XRPL network
      refundTxHash = await xrplClient.refund(transactionHash);
    } else {
      // If the network is not recognized, return an error
      return res.status(400).send({ error: 'Invalid network' });
    }

    // Return the transaction hash of the refund transaction to the client
    res.status(200).send({ transactionHash: refundTxHash });
  } catch (error) {
    // Return an error message to the client if something went wrong
    res.status(500).send({ error: error.message });
  }
});

app.get('/transactions/:address', async (req, res) => {
  try {
    const { address } = req.params;

    // Retrieve the Cosmos transactions for the address
    const cosmosTxs = await cosmosClient.getTransactions(address);

    // Retrieve the XRPL transactions for the address
    const xrplTxs = await xrplClient.getTransactions(address);

    // Combine the transactions from both networks
    const allTxs = [...cosmosTxs, ...xrplTxs];

    // Sort the transactions by timestamp in descending order
    allTxs.sort((a, b) => b.timestamp - a.timestamp);

    // Return the transactions to the client
    res.status(200).send({ transactions: allTxs });
  } catch (error) {
    // Return an error message to the client if something went wrong
    res.status(500).send({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});