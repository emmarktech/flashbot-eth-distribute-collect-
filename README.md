1. Run the following command to install ethers.js, which is used to interact with blockchain networks such as Ethereum and BNB:


npm install ethers dotenv prompt-sync

2. Create .env files To avoid hardcoding sensitive information such as private keys in your code, use .env files to store them. You need to install the dotenv library to read data in .env files:



3. How to run and use

Perform bulk distribution or aggregation using flashbot
Edit the .env file to ensure that all wallet private keys, Infura project IDs and other information have been set correctly.

4. In the project directory, use the following command to run the script: node script.js

If there is no response after running for a long time, it may be due to low rpc or gas, and has nothing to do with the code.

The script automatically performs the operation of distributing or collecting ETH(BNB) and prints the balance of each wallet.

Eth or bnb can choose their own different rpc mainnets!