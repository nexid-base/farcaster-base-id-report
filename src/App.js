import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { Alchemy, Network } from 'alchemy-sdk';
import './App.css';
import headerImage from './header.png';

// Initialize Alchemy SDK
const alchemy = new Alchemy({
  apiKey: process.env.REACT_APP_ALCHEMY_API_KEY,
  network: Network.BASE_MAINNET,
});

// Initialize Infura provider
const infuraProvider = new ethers.JsonRpcProvider(`https://mainnet.infura.io/v3/${process.env.REACT_APP_INFURA_API_KEY}`);

// Utility function for logging with timestamps
const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
};

function App() {
  // State variables
  const [input, setInput] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState('');

  // Function to update frame metadata
  const updateFrameMetadata = useCallback((stage, data = {}) => {
    log('Updating frame metadata', { stage, data });
    const baseUrl = 'https://farcaster-base-id-report.vercel.app';
    let imageUrl = `${baseUrl}/api/generate-image?stage=${stage}`;

    if (stage === 'result') {
      const params = new URLSearchParams({
        address: data.address,
        balance: data.balance,
        txCount: data.txCount,
        category: data.category,
        lastActivity: data.lastActivity,
        lastGasPaid: data.lastGasPaid,
        nftCount: data.nftCount,
        collectionCount: data.collectionCount,
        insiderTokens: JSON.stringify(data.insiderTokens)
      });
      imageUrl += `&${params.toString()}`;
    }

    const metaTags = [
      { property: 'og:image', content: imageUrl },
      { property: 'fc:frame', content: 'vNext' },
      { property: 'fc:frame:image', content: imageUrl },
      { property: 'fc:frame:button:1', content: stage === 'initial' ? 'Look up ENS/Address' : 'New Search' },
      { property: 'fc:frame:input:text', content: 'Enter ENS name or Ethereum address' },
    ];

    if (stage === 'result') {
      metaTags.push({ property: 'fc:frame:button:2', content: 'View Full Report' });
      metaTags.push({ property: 'fc:frame:button:2:action', content: 'post_redirect' });
      metaTags.push({ property: 'fc:frame:button:2:target', content: `${baseUrl}/report?address=${data.address}` });
    }

    metaTags.forEach(tag => {
      let element = document.querySelector(`meta[property="${tag.property}"]`);
      if (element) {
        element.setAttribute('content', tag.content);
      } else {
        element = document.createElement('meta');
        element.setAttribute('property', tag.property);
        element.setAttribute('content', tag.content);
        document.head.appendChild(element);
      }
    });

    // Correct the validation URL
    let validateElement = document.querySelector('meta[name="fc:frame:validate"]');
    if (!validateElement) {
      validateElement = document.createElement('meta');
      validateElement.setAttribute('name', 'fc:frame:validate');
      document.head.appendChild(validateElement);
    }
    validateElement.setAttribute('content', `${baseUrl}/validateFrameEmbed`);

    log('Frame metadata updated');
  }, []);

  // Effect for initial setup and cleanup
  useEffect(() => {
    log('App component mounted');
    updateFrameMetadata('initial');

    // Apply dark mode to body
    document.body.className = isDarkMode ? 'dark-mode' : 'light-mode';

    // Save dark mode preference
    localStorage.setItem('darkMode', isDarkMode);

    return () => {
      log('App component will unmount');
    };
  }, [isDarkMode, updateFrameMetadata]);

  // Function to safely format Ether values
  const safeFormatEther = useCallback((value) => {
    try {
      const valueString = typeof value === 'object' ? value.toString() : String(value);
      return ethers.formatEther(valueString);
    } catch (err) {
      log('Error formatting ether value', err);
      return 'Error';
    }
  }, []);

  // Function to categorize accounts based on transaction count
  const categorizeAccount = useCallback((txCount) => {
    log('Categorizing account', { txCount });
    if (txCount < 10) return 'Plankton';
    if (txCount < 100) return 'Shrimp';
    if (txCount < 1000) return 'Shark';
    return 'Whale';
  }, []);

  // Function to fetch NFT data for an address
  const fetchNFTData = useCallback(async (address) => {
    try {
      log('Fetching NFT data', { address });
      const nftsForOwner = await alchemy.nft.getNftsForOwner(address);
      const nftCount = nftsForOwner.totalCount;
      const collections = new Set(nftsForOwner.ownedNfts.map(nft => nft.contract.address));
      log('NFT data fetched', { nftCount, collectionCount: collections.size });
      return { nftCount, collectionCount: collections.size };
    } catch (error) {
      log('Error fetching NFT data', error);
      throw new Error('Failed to fetch NFT data');
    }
  }, []);

  // Function to get total supply of a token
  const getTotalSupply = useCallback(async (contractAddress) => {
    try {
      // First, try to get the total supply from Alchemy's token metadata
      const tokenMetadata = await alchemy.core.getTokenMetadata(contractAddress);
      if (tokenMetadata.totalSupply) {
        return ethers.getBigInt(tokenMetadata.totalSupply);
      }

      // If Alchemy doesn't have the total supply, query the contract directly
      const provider = new ethers.JsonRpcProvider(`https://mainnet.base.org`);
      const erc20ABI = [
        'function totalSupply() view returns (uint256)',
        'function decimals() view returns (uint8)',
      ];
      const contract = new ethers.Contract(contractAddress, erc20ABI, provider);
      const totalSupply = await contract.totalSupply();
      return totalSupply;
    } catch (error) {
      log('Error fetching total supply', error);
      throw error;
    }
  }, []);

  // Function to check insider status for tokens
  const checkInsiderStatus = useCallback(async (address) => {
    try {
      log('Checking insider status', { address });
      const balances = await alchemy.core.getTokenBalances(address);
      const insiderTokens = [];

      for (const balance of balances.tokenBalances) {
        if (balance.tokenBalance) {
          try {
            const tokenMetadata = await alchemy.core.getTokenMetadata(balance.contractAddress);
            const totalSupply = await getTotalSupply(balance.contractAddress);
            const holdingPercentage = (Number(ethers.formatUnits(balance.tokenBalance, tokenMetadata.decimals)) / Number(ethers.formatUnits(totalSupply, tokenMetadata.decimals))) * 100;

            if (holdingPercentage > 1) {
              insiderTokens.push({
                name: tokenMetadata.name || 'Unknown',
                symbol: tokenMetadata.symbol || 'Unknown',
                holdingPercentage: holdingPercentage.toFixed(2),
                contractAddress: balance.contractAddress
              });
              log('Insider token found', { token: tokenMetadata.name, percentage: holdingPercentage.toFixed(2) });
            }
          } catch (error) {
            log('Error checking insider status for token', { contractAddress: balance.contractAddress, error: error.message });
          }
        }
      }

      return insiderTokens;
    } catch (error) {
      log('Error checking insider status', error);
      throw new Error('Failed to check insider status');
    }
  }, [getTotalSupply]);

  // Main function to fetch all data
  const fetchData = useCallback(async (inputValue) => {
    log('Fetching data', { inputValue });
    setError('');
    setResult(null);
    setIsLoading(true);
    setLoadingProgress(0);
    setLoadingMessage('Initializing...');

    try {
      // Resolve address
      setLoadingProgress(10);
      setLoadingMessage('Resolving address...');
      let resolvedAddress;
      if (ethers.isAddress(inputValue)) {
        log('Input is a valid Ethereum address');
        resolvedAddress = inputValue;
      } else {
        log('Attempting to resolve ENS name using Infura');
        resolvedAddress = await infuraProvider.resolveName(inputValue);
        log('ENS name resolved', { resolvedAddress });
      }

      if (!resolvedAddress) {
        throw new Error('No address found for this input.');
      }

      // Fetch blockchain data
      setLoadingProgress(30);
      setLoadingMessage('Fetching blockchain data...');
      log('Fetching blockchain data using Alchemy');
      const [balance, txCount] = await Promise.all([
        alchemy.core.getBalance(resolvedAddress),
        alchemy.core.getTransactionCount(resolvedAddress),
      ]);

      log('Blockchain data fetched', { balance: balance.toString(), txCount });

      const formattedBalance = safeFormatEther(balance);
      log('Formatted balance', { formattedBalance });

      // Fetch last transfer
      setLoadingProgress(50);
      setLoadingMessage('Fetching last transfer...');
      const transfers = await alchemy.core.getAssetTransfers({
        fromBlock: '0x0',
        toBlock: 'latest',
        fromAddress: resolvedAddress,
        category: ['external', 'erc20', 'erc721', 'erc1155'],
        order: 'desc',
        maxCount: 1,
      });

      log('Last transfer fetched', transfers);

      let lastActivity = 'N/A';
      let lastGasPaid = 'N/A';

      if (transfers.transfers.length > 0) {
        const lastTransfer = transfers.transfers[0];
        // Correct date calculation
        const blockNumber = parseInt(lastTransfer.blockNum, 16);
        try {
          const block = await alchemy.core.getBlock(blockNumber);
          lastActivity = new Date(block.timestamp * 1000).toLocaleString();
        } catch (error) {
          log('Error fetching block timestamp', error);
          lastActivity = 'Error fetching date';
        }
        lastGasPaid = lastTransfer.value ? `${lastTransfer.value} ETH` : 'N/A';
      }

      // Fetch NFT data
      setLoadingProgress(70);
      setLoadingMessage('Fetching NFT data...');
      const { nftCount, collectionCount } = await fetchNFTData(resolvedAddress);

      // Check insider status
      setLoadingProgress(85);
      setLoadingMessage('Checking insider status...');
      const insiderTokens = await checkInsiderStatus(resolvedAddress);

      const result = {
        address: resolvedAddress,
        balance: formattedBalance,
        txCount,
        category: categorizeAccount(txCount),
        lastActivity,
        lastGasPaid,
        nftCount,
        collectionCount,
        insiderTokens
      };

      log('Result prepared', result);
      setResult(result);
      updateFrameMetadata('result', result);
      setLoadingProgress(100);
      setLoadingMessage('Complete!');
    } catch (error) {
      log('Error in fetchData', error);
      setError(error.message);
      updateFrameMetadata('error', { error: error.message });
      setLoadingProgress(100);
      setLoadingMessage('Error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [safeFormatEther, categorizeAccount, fetchNFTData, checkInsiderStatus, updateFrameMetadata]);

  // Event handler for form submission
  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    log('Form submitted', { input });
    fetchData(input);
  }, [input, fetchData]);

  // Function to toggle dark mode
  const toggleDarkMode = useCallback(() => {
    setIsDarkMode(prevMode => !prevMode);
    log('Dark mode toggled', { isDarkMode: !isDarkMode });
  }, [isDarkMode]);

  // Function to get Basescan URL for a contract address
  const getBasescanUrl = useCallback((contractAddress) => {
    return `https://basescan.org/token/${contractAddress}`;
  }, []);

  // Render component
  return (
    <div className={`App ${isDarkMode ? 'dark-mode' : 'light-mode'}`}>
      <div className="header-container">
        <img src={headerImage} alt="Header" className="header-image" />
      </div>
      <h1>ENS/Address Lookup on Base</h1>
      <button onClick={toggleDarkMode} className="theme-toggle">
        {isDarkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
      </button>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter ENS name or Ethereum address"
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading}>
          {isLoading ? 'Searching...' : 'Search'}
        </button>
      </form>
      {isLoading && (
        <div className="loading-container">
          <div className="loading-bar-container">
            <div 
              className="loading-bar" 
              style={{width: `${loadingProgress}%`}}
            ></div>
          </div>
          <p className="loading-message">{loadingMessage}</p>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {result && (
        <div className="result">
          <h2>Result:</h2>
          <div className="result-grid">
            <div className="result-box">
              <h3>Address</h3>
              <p>{result.address}</p>
            </div>
            <div className="result-box">
              <h3>Balance</h3>
              <p>{result.balance} ETH</p>
            </div>
            <div className="result-box">
              <h3>Transaction Count</h3>
              <p>{result.txCount}</p>
            </div>
            <div className="result-box">
              <h3>Category</h3>
              <p>{result.category}</p>
            </div>
            <div className="result-box">
              <h3>Last Activity</h3>
              <p>{result.lastActivity}</p>
            </div>
            <div className="result-box">
              <h3>Last Gas Paid</h3>
              <p>{result.lastGasPaid}</p>
            </div>
            <div className="result-box">
              <h3>NFT Count</h3>
              <p>{result.nftCount}</p>
            </div>
            <div className="result-box">
              <h3>Collection Count</h3>
              <p>{result.collectionCount}</p>
            </div>
          </div>
          <div className="insider-tokens-container">
            <h3>Insider Tokens</h3>
            {result.insiderTokens.length > 0 ? (
              <div className="result-grid insider-tokens-grid">
                {result.insiderTokens.map((token, index) => (
                  <a 
                    key={index}
                    className="result-box insider-token-box"
                    href={getBasescanUrl(token.contractAddress)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <h4>{token.name} ({token.symbol})</h4>
                    <p>Holding: {token.holdingPercentage}%</p>
                  </a>
                ))}
              </div>
            ) : (
              <p>No insider tokens found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
