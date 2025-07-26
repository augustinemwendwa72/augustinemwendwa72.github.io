
        // --- DOM Elements ---
        const connectBtn = document.getElementById('connect-btn');
        const apiTokenInput = document.getElementById('api-token');
        const appIdInput = document.getElementById('app-id');
        const togglePasswordBtn = document.getElementById('toggle-password');
        const eyeIcon = document.getElementById('eye-icon');
        const eyeOffIcon = document.getElementById('eye-off-icon');

        const statusLight = document.getElementById('status-light');
        const statusText = document.getElementById('status-text');
        const accountSelectionCard = document.getElementById('account-selection-card');
        const accountSelect = document.getElementById('account-select');
        const botControlsCard = document.getElementById('bot-controls-card');
        const accountBalance = document.getElementById('account-balance');

        const totalHistoricalTicksSelect = document.getElementById('total-historical-ticks');
        const syntheticIndexSelect = document.getElementById('synthetic-index');
        const tradeTypeSelect = document.getElementById('trade-type');
        const stakeAmountInput = document.getElementById('stake-amount');
        const fetchDataBtn = document.getElementById('fetch-data-btn');
        const startBotBtn = document.getElementById('start-bot-btn');
        const stopBotBtn = document.getElementById('stop-bot-btn');

        const predictionCard = document.getElementById('prediction-card');
        const predictionSequence = document.getElementById('prediction-sequence');
        const predictionDetails = document.getElementById('prediction-details');
        
        const analysisSummary1000 = document.getElementById('analysis-summary-1000');
        const digitChart1000 = document.getElementById('digit-chart-1000');
        
        const customTickCountSelect = document.getElementById('custom-tick-count');
        const analysisSummaryCustom = document.getElementById('analysis-summary-custom');
        const digitChartCustom = document.getElementById('digit-chart-custom');

        const numTradesToShowSelect = document.getElementById('num-trades-to-show');
        const tradesList = document.getElementById('trades-list');

        const logsContainer = document.getElementById('logs-container');
        const clearLogsBtn = document.getElementById('clear-logs-btn');
        const tradeTickDurationSelect = document.getElementById('trade-tick-duration');
        const martingaleValueSelect = document.getElementById('martingale-value');
        let symbol = '';

        // --- State Variables ---
        let websocket;
        let isAuthenticated = false;
        let isBotRunning = false;
        let tickHistory = [];
        let allTickHistory = []; // Stores all historical ticks as they come in + live ticks
        let tradeHistory = [];
        let lastContractId = null;
        let accounts = [];
        let pingInterval;
        let currentApiToken = '';
        let currentProposal = null;
        let isWaitingForTradeOutcome = false; // New flag to control trade cycle
        let isWaitingForTradeProposal = false; // New flag to control proposal request state

        let totalTicksToFetch = 1000;
        let fetchedTicksCount = 0;
        let lastFetchedTimestamp = null;
        let isFetchingHistoricalTicks = false;
        let historyFetchReqId = 0;
        let profitTableReqId = 0;

        let myClowestDigit = 0;
        let myChighestDigit = 0;
        let myAlowestDigit = 0
        let myAhighestDigit = 0;
        let lastPercentageCheck = 0;

        let percentageSummary = 'Occurrences: ';
        let minPercentage = Infinity;
        let maxPercentage = -1;
        let lowestDigit = -1;
        let highestDigit = -1;
        let LWD = -1;
        let HWD = -1;

        let pendingTradeCounter = 0; // Counter for pending trades
        let MAX_PENDING_TRADES = 5; // Maximum allowed pending trades before stopping the bot

        let lastDiffTradeTimestamp = 0; // Cooldown for DIGITDIFF trades

        const DEFAULT_DERIV_APP_ID = 65499;
        const PING_INTERVAL_MS = 20000;
        const MAX_TICKS_PER_API_CALL = 5000;
        const MAX_PROFIT_TABLE_LIMIT = 250; // This is a hard limit by Deriv API, not configurable by dropdown directly.
        const CONFIDENCE_THRESHOLD_EVEN_ODD = 51; // New threshold for Even/Odd
        const CONFIDENCE_THRESHOLD_OVER_UNDER = 62.5; // New threshold for Over/Under
        const DIFF_TRADE_COOLDOWN_MS = 15000; // 15 seconds cooldown for DIGITDIFF trades

        // --- WebSocket Logic ---
        // --- Begin: Differs Martingale Logic (GLOBAL SCOPE) ---
        let differsMartingaleActive = false;
        let differsMartingaleCount = 0;
        let differsMartingaleInitialStake = null;
        let differsMartingaleShouldTrigger = false;
        let differsMartingaleConsecWins = 0;
        let differsMartingaleWaiting = false;
        let LowPercentage = false;

        let martingaleNow = false;

        let prediction_output = {};
        let MA = 0;
        let LA = 0;
        let AP = 0;
        let durationWhole = 0;
        let durationPrediction = 0;
        let formattedData = JSON.stringify({});
        let proposalRequest = null;
        let selectedTradeType = null; // This will be set based on the trade type selected by the user
        let foundTradeConditions = false;

        let waitingForServerRes = false;
    

        function connect() {
            const apiToken = apiTokenInput.value;
            const appId = appIdInput.value || DEFAULT_DERIV_APP_ID;
            if (!apiToken) {
                logMessage('Please enter an API Token.', 'error');
                return;
            }
        
            currentApiToken = apiToken;
        
            logMessage(`Connecting to Deriv with App ID: ${appId}...`, 'info');
            updateStatus('Connecting...', 'yellow', true);
            
            websocket = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${appId}`);
        
            websocket.onopen = () => {
                logMessage('WebSocket connection opened.', 'info');
                websocket.send(JSON.stringify({ authorize: currentApiToken }));
                startPinging();
            };
            websocket.onmessage = (event) => handleMessage(JSON.parse(event.data));
            websocket.onclose = () => {
                logMessage('WebSocket connection closed.', 'error');
                resetAppState("WebSocket closed unexpectedly");
                stopPinging();
                logMessage('Connection closed.', 'error');
            };
            websocket.onerror = (error) => {
                stopPinging();
                logMessage(`WebSocket Error: ${JSON.stringify(error)}`, 'error');
            };
        }

        function startPinging() {
            if (pingInterval) clearInterval(pingInterval);
            pingInterval = setInterval(() => {
                if (websocket && websocket.readyState === WebSocket.OPEN) {
                    websocket.send(JSON.stringify({ ping: 1 }));
                    logMessage('Sent WebSocket ping.', 'api');
                }
            }, PING_INTERVAL_MS);
            logMessage(`Started pinging every ${PING_INTERVAL_MS / 1000} seconds.`, 'info');
        }

        function stopPinging() {
            if (pingInterval) {
                clearInterval(pingInterval);
                pingInterval = null;
                logMessage('Stopped WebSocket pings.', 'info');
            }
        }

        function handleMessage(data) {

            if (data.error) {
                logMessage(`Error: ${data.error.message}`, 'error');
                if (data.error.code === 'AuthorizationFailed' || data.error.code === 'InvalidAppID') {
                    resetAppState("Authorization failed. Please check your API token and App ID.");
                }
                return;
            }
            
            switch (data.msg_type) {
                case 'authorize':
                    handleAuthorization(data.authorize);
                    break;
                
                case 'history':
                    if (data.echo_req.req_id === historyFetchReqId) {
                        const newPrices = data.history.prices.map(p => p.toString());
                        const newTimes = data.history.times;

                        allTickHistory.unshift(...newPrices);
                        fetchedTicksCount += newPrices.length;

                        if (newTimes && newTimes.length > 0) {
                            lastFetchedTimestamp = newTimes[0];
                        }

                        logMessage(`Fetched ${newPrices.length} ticks. Total fetched: ${fetchedTicksCount}/${totalTicksToFetch}.`, 'info');
                        
                        if (fetchedTicksCount < totalTicksToFetch && newPrices.length > 0) {
                            // logMessage(`Requesting next batch of historical ticks.`, 'info');
                            setTimeout(requestNextHistoryBatch, 500);
                        } else {
                            // logMessage(`--- END Historical Tick Data Fetch (Total: ${allTickHistory.length}) ---`, 'info');
                            isFetchingHistoricalTicks = false;
                            // fetchDataBtn.disabled = false;
                            updateStatus(`Logged in as ${accountSelect.value}`, 'green');
                            tickHistory = allTickHistory.slice(-totalTicksToFetch);
                            // logMessage('Historical data fetched. Running initial full analysis.', 'info');
                             if(!foundTradeConditions && !isWaitingForTradeProposal && !isWaitingForTradeOutcome){
                                runFullAnalysis(); // Run full analysis once historical data is fully fetched
                                runCustomAnalysis(); // Update the custom chart
                                checkPercentageForTrade(); // Check percentage for trade after full analysis
                             }
                             // checkPercentageForTrade(); // Check percentage for trade after full analysis
                            // if(checkPercentageForTrade()) {
                            //     logMessage('Trade conditions met. Sending Data to predictor.', 'success');
                            //     checkPercentageForTrade();
                            // } else {
                            //     logMessage('Trade conditions not met. Skipping data send to predictor.', 'warning');
                            // }
                            subscribeToTicks(syntheticIndexSelect.value);
                        }
                    }
                    break;
                    
                case 'tick':
                    if (allTickHistory.length > 0) {
                        // logMessage(`New tick received. Live value: ${data.tick.quote}. Updating analysis charts.`, 'info');
                        // // Always update tickHistory and run custom analysis for live chart updates
                        // allTickHistory.push(data.tick.quote.toString());
                        // if (allTickHistory.length > totalTicksToFetch) allTickHistory.shift(); 
                        // tickHistory = allTickHistory.slice(-totalTicksToFetch);
                        if(!foundTradeConditions && !isWaitingForTradeProposal && !isWaitingForTradeOutcome && !waitingForServerRes){
                            fetchData();
                        }
                    }
                    break;
                
                case 'proposal':
                    if (data.proposal) {
                        currentProposal = data.proposal;
                        logMessage(`Received Proposal: ID ${currentProposal.id}, Ask Price: ${currentProposal.ask_price}`, 'success');
                        if (isBotRunning) {
                            sendBuyOrder(currentProposal.id, currentProposal.ask_price);
                        }
                    } else if (data.proposal_open) {
                        logMessage(`Proposal open (ID: ${data.proposal_open.id}), Current Price: ${data.proposal_open.current_price}`, 'api');
                    }
                    break;

                case 'buy':
                    if (data.buy) {
                        const contract = data.buy;
                        logMessage(`Trade placed. Contract ID: ${contract.contract_id}, Payout: ${contract.payout}`, 'success');
                        lastContractId = contract.contract_id;
                        isWaitingForTradeProposal = false
                        isWaitingForTradeOutcome = true; // Mark that we are waiting for the outcome of this trade
                    }
                    break;

                case 'transaction':
                     if (data.transaction && data.transaction.contract_id) {
                        // Check if this transaction is related to our last placed trade
                        if (data.transaction.contract_id === lastContractId) {
                            logMessage(`Transaction for our contract (${data.transaction.contract_id}) detected. Action: ${data.transaction.action}, Status: ${data.transaction.status}`, 'info');
                            logMessage(`Transaction Details: ${JSON.stringify(data.transaction)}`, 'api');
                            // Update account balance  
                            accountBalance.innerHTML = `Balance: <span class="text-blue-400">${data.transaction.balance.toFixed(2)}</span> ${data.transaction.currency}`;
                            // Only reset isWaitingForTradeOutcome if the contract is clearly concluded (sold or expired)
                            // The 'sell' or 'payout' action usually indicates conclusion.
                            // The 'InvalidContract' status on a buy also indicates immediate conclusion (failed buy)
                             //accountBalance.innerHTML = `Balance: <span class="text-blue-400">${data.balance.toFixed(2)}</span> ${data.currency}`;

                            if (data.transaction.action === 'sell' || data.transaction.action === 'payout' || data.transaction.status === 'InvalidContract') {
                                isWaitingForTradeOutcome = false; // Mark trade cycle as complete
                                logMessage(`Contract ${data.transaction.contract_id} concluded. Result will be updated from Profit Table.`, 'success');
                                if (isBotRunning) {
                                    logMessage('Trade cycle complete. Waiting for next tick to propose a new trade.', 'info');
                                }
                                fetchTradeHistoryFromAPI(); // Refresh profit table immediately
                            } else if (data.transaction.action === 'buy') {
                                // This is just a purchase, trade is now open.
                                logMessage(`Our contract (${data.transaction.contract_id}) was successfully purchased.`, 'info');
                            }
                        } else {
                            // Log other transactions not related to our active bot trade
                            logMessage(`Received non-bot transaction: ${JSON.stringify(data.transaction)}`, 'api');
                        }
                    }
                    break;
                
                case 'profit_table':
                    // logMessage(`Received profit table update: ${JSON.stringify(data.profit_table)}`, 'api');
                    if (data.echo_req.req_id === profitTableReqId) {
                        tradeHistory = data.profit_table.transactions.map(transaction => {
                            let predictedDisplay = '?';
                            if (transaction.shortcode.includes('DIGITMATCH') || transaction.shortcode.includes('DIGITDIFF') ||
                                transaction.shortcode.includes('DIGITOVER') || transaction.shortcode.includes('DIGITUNDER')) {
                                const barrierMatch = transaction.shortcode.match(/(?:DIGITMATCH|DIGITDIFF|DIGITOVER|DIGITUNDER):(\d)/);
                                if (barrierMatch && barrierMatch[1]) {
                                    predictedDisplay = barrierMatch[1];
                                }
                            } else if (transaction.shortcode.includes('DIGITODD')) {
                                predictedDisplay = 'Odd';
                            } else if (transaction.shortcode.includes('DIGITEVEN')) {
                                predictedDisplay = 'Even';
                            }

                            let finalProfit;
                            let tradeResult;

                            // Determine profit and result based on sell_price and buy_price
                            if (parseFloat(transaction.sell_price) === 0) {
                                // If sell_price is 0, it indicates a loss. Profit is negative of the stake.
                                tradeResult = 'Lost';
                                finalProfit = -parseFloat(transaction.buy_price);
                                
                            } else {
                                // If sell_price > 0, calculate profit/loss.
                                finalProfit = parseFloat(transaction.sell_price) - parseFloat(transaction.buy_price);
                                tradeResult = finalProfit >= 0 ? 'Won' : 'Lost'; // 'Won' if profit >= 0, 'Lost' if negative
                                }

                            return {
                                id: transaction.contract_id,
                                type: transaction.shortcode.match(/DIGIT(MATCH|DIFF|OVER|UNDER|ODD|EVEN)/)?.[0] || 'Unknown',
                                // predicted is not used in display but kept for data integrity in trade object
                                predicted: predictedDisplay, 
                                stake: parseFloat(transaction.buy_price),
                                profit: finalProfit,
                                result: tradeResult,
                                timestamp: new Date(transaction.purchase_time * 1000).toLocaleTimeString(),
                                purchase_time: transaction.purchase_time
                            };
                        });
                        logMessage(`Fetched ${tradeHistory.length} trades from Profit Table.`, 'info');
                        renderTradeHistory();
                        // --- Martingale logic for all trades ---
                        if (tradeHistory.length > 1) {
                            const lastTrade = tradeHistory[0];
                            const prevTrade = tradeHistory[1];
                            const prevTrade2 = tradeHistory[2];

                            // If last trade is a loss, enable martingale
                            if (lastTrade.result === 'Lost' && prevTrade.result === 'Won' && prevTrade2.result === 'Won') {
                                martingaleNow = true;
                                martingaleStage = 1; // Reset martingale stage
                                logMessage('Martingale stage 1.', 'info');
                            }
                            // else if (lastTrade.result === 'Lost' && prevTrade.result === 'Lost' && prevTrade2.result === 'Won'){
                            //     martingaleNow = true;
                            //     martingaleStage = 2; // Move to stage 2 if already in martingale
                            //     logMessage('Martingale stage 2.', 'info');
                            // }
                            else{
                                martingaleNow = false;
                                logMessage('Martingale not triggered: Last trade was a win or no previous trade.', 'info');
                            }

                            // // If previous trade was a loss and last trade is a win, reset martingale
                            // if (prevTrade.result === 'Won' && lastTrade.result === 'Won') {
                            //     martingaleNow = false;
                            //     logMessage('Martingale reset: Consecutive win after a loss. Stake returns to normal.', 'info');
                            // }
                        }
                    }
                    break;
            }
        }

        function handleAuthorization(authData) {
            isAuthenticated = true;
            accounts = authData.account_list;
            updateStatus(`Logged in as ${authData.loginid}`, 'green');
            logMessage(`Authorization successful. Welcome ${authData.email}.`, 'success');

            accountSelect.innerHTML = '';
            accounts.forEach(acc => {
                const option = document.createElement('option');
                option.value = acc.loginid;
                option.textContent = `${acc.loginid} (${acc.is_virtual ? 'Virtual' : 'Real'}, ${acc.currency})`;
                accountSelect.appendChild(option);
            });

            accountSelect.value = authData.loginid;
            accountBalance.innerHTML = `Balance: <span class="text-blue-400">${authData.balance.toFixed(2)}</span> ${authData.currency}`;
            
            accountSelectionCard.classList.remove('hidden');
            botControlsCard.classList.remove('hidden');
            predictionCard.classList.remove('hidden');
            apiTokenInput.disabled = true;
            appIdInput.disabled = true;
            connectBtn.textContent = 'Disconnect';
            connectBtn.classList.replace('bg-blue-600', 'bg-red-600');
            connectBtn.classList.replace('hover:bg-blue-700', 'hover:bg-red-700');

            // Initial fetch of trade history upon authorization
            logMessage('Initial fetch of trade history upon authorization.', 'info');
            
            fetchTradeHistoryFromAPI(); 
            fetchData();

            // Subscribe to all transactions immediately after authentication
            // and whenever connection status changes (implicitly via re-auth on re-connect)
            websocket.send(JSON.stringify({ transaction: 1, subscribe: 1 }));
            logMessage('Subscribed to transaction stream for continuous updates.', 'info');
        }

        function subscribeToTicks(symbol) {
            logMessage(`Subscribing to ticks for ${symbol}...`, 'info');
            websocket.send(JSON.stringify({ forget_all: 'ticks' }));
            websocket.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
        }
        
        function fetchData() {
            if (!isAuthenticated) {
                logMessage('Please connect first to fetch data.', 'error');
                return;
            }
            if (isFetchingHistoricalTicks) {
                logMessage('Already fetching historical ticks. Please wait.', 'info');
                return;
            }

            const symbol = syntheticIndexSelect.value;
            totalTicksToFetch = parseInt(totalHistoricalTicksSelect.value);

            logMessage(`Initiating historical data fetch for ${totalTicksToFetch} ticks on ${symbol}.`, 'info');
            updateStatus('Fetching data...', 'yellow', true);

            allTickHistory = [];
            fetchedTicksCount = 0;
            lastFetchedTimestamp = null;
            isFetchingHistoricalTicks = true;
            fetchDataBtn.disabled = true;
            startBotBtn.disabled = false;
            historyFetchReqId++;

            requestNextHistoryBatch();
        }

        function requestNextHistoryBatch() {
            symbol = syntheticIndexSelect.value;
            const countForThisCall = Math.min(MAX_TICKS_PER_API_CALL, totalTicksToFetch - fetchedTicksCount);
            
            if (countForThisCall <= 0) {
                logMessage(`--- All requested historical ticks (${allTickHistory.length}) fetched. ---`, 'info');
                isFetchingHistoricalTicks = false;
                // fetchDataBtn.disabled = false;
                updateStatus(`Logged in as ${accountSelect.value}`, 'green');
                tickHistory = allTickHistory.slice(-totalTicksToFetch);
                logMessage('Historical data fully fetched. Running initial full analysis.', 'info');
                runFullAnalysis(); // Run full analysis once historical data is fully fetched
                runCustomAnalysis(); // Update the custom chart
                subscribeToTicks(syntheticIndexSelect.value);
                return;
            }

            const request = {
                ticks_history: symbol,
                end: lastFetchedTimestamp || "latest",
                count: countForThisCall,
                style: "ticks",
                req_id: historyFetchReqId
            };
            
            logMessage(`Fetching historical ticks batch (req_id: ${historyFetchReqId}, count: ${countForThisCall}, end: ${request.end}).`, 'api');
            websocket.send(JSON.stringify(request));
        }

        function fetchTradeHistoryFromAPI() {
            if (!isAuthenticated) {
                logMessage('Not authenticated. Cannot fetch trade history.', 'error');
                return;
            }
            profitTableReqId++;
            const selectedLimit = numTradesToShowSelect.value;
            let limit = MAX_PROFIT_TABLE_LIMIT; // Default to API max limit

            if (selectedLimit !== 'all') {
                limit = parseInt(selectedLimit);
            }
            
            logMessage(`Requesting Profit Table (limit: ${limit})...`, 'info');
            websocket.send(JSON.stringify({
                profit_table: 1,
                description: 1, // Include shortcode for parsing
                limit: limit,
                offset: 0,
                sort: 'DESC',
                req_id: profitTableReqId
            }));
        }


        // --- Helper functions for uniform decimal formatting ---
function getMaxObservedDecimals(prices) {
    let maxDecimals = 0;
    prices.forEach(price => {
        const parts = price.split('.');
        if (parts.length === 2) {
            maxDecimals = Math.max(maxDecimals, parts[1].length);
        }
    });
    return maxDecimals;
}

function formatPriceForExtraction(price, decimals) {
    if (typeof price !== 'string') price = price.toString();
    if (!price.includes('.')) {
        return price + '.' + '0'.repeat(decimals);
    }
    const [intPart, decPart] = price.split('.');
    return intPart + '.' + decPart.padEnd(decimals, '0');
}


// --- Analysis & Prediction Logic ---
        function runFullAnalysis() {
            //logMessage('Running full digit analysis and prediction model.', 'info');
            // Ensure tickHistory always reflects the selected totalHistoricalTicks
            let maxObservedDecimals = getMaxObservedDecimals(allTickHistory);
            // logMessage('=====================================================================', 'info');
            // logMessage('initial price list: ' + JSON.stringify(allTickHistory), 'info');
            // logMessage('=====================================================================', 'info');
            

            tickHistory = allTickHistory
                .slice(-parseInt(totalHistoricalTicksSelect.value))
                .map(price => formatPriceForExtraction(price, maxObservedDecimals));
                // logMessage('modified Price List: ' + JSON.stringify(tickHistory), 'info');
            if (tickHistory.length === 0) {
                predictionSequence.textContent = '[ ? ? ? ]';
                predictionDetails.innerHTML = 'Predicted Value: --, Confidence: --%, Type: --';
                logMessage('Not enough tick history for full analysis. Displaying placeholders.', 'info');
                return;
            }
            
            // Always update the 'All Fetched Ticks' chart
            let allFetchedLastDigits = tickHistory.map(price => price.slice(-1));

            // Convert last digits to integers before sending
            const integerDigits = allFetchedLastDigits.map(d => parseInt(d));
            formattedData = JSON.stringify({"data": integerDigits});
            


            myAlowestDigit, myAhighestDigit = analyzeAndDisplay(allFetchedLastDigits, digitChart1000, analysisSummary1000, `Analysis of the last ${allFetchedLastDigits.length} ticks.`, true);
            myAlowestDigit = LWD;
            myAhighestDigit = HWD;
            // logMessage(`Assigned LWD and HWD for the full analysis`, 'info');

            // Run prediction model based on the current tickHistory subset
            const analysisLastDigits = tickHistory.map(price => price.slice(-1));
            const predictionData = runPredictionModel(analysisLastDigits);
            
            selectedTradeType = tradeTypeSelect.value;

            predictionSequence.textContent = `[ ${predictionData.digitSequence.join(' ')} ]`; // Always show the 3-digit sequence
            logMessage(`Predicted digit sequence: [ ${predictionData.digitSequence.join(' ')} ]`, 'info');


              }
        
        function runCustomAnalysis() {
            // logMessage('Updating custom tick analysis chart.', 'info');
            if (tickHistory.length === 0) return;
            const count = parseInt(customTickCountSelect.value);
            const customTicks = tickHistory.slice(-count);
            const lastDigitsCustom = customTicks.map(price => price.slice(-1));
            
            myClowestDigit, myChighestDigit = analyzeAndDisplay(lastDigitsCustom, digitChartCustom, analysisSummaryCustom, `Analysis of the last ${customTicks.length} ticks.`, false);
            myClowestDigit = LWD;
            myChighestDigit = HWD;
        }

        function analyzeAndDisplay(digits, chartElement, summaryElement, summaryText, isAllTicksChart) {
            const digitCounts = {};
            for (let i = 0; i < 10; i++) digitCounts[i] = 0;
            digits.forEach(digit => digitCounts[digit]++);
            
            chartElement.innerHTML = '';
            summaryElement.textContent = summaryText;

            percentageSummary = 'Occurrences: ';
            minPercentage = Infinity;
            maxPercentage = -1;
            lowestDigit = -1;
            highestDigit = -1;

            if (digits.length > 0) {
                for (let i = 0; i < 10; i++) {
                    const count = digitCounts[i] || 0;
                    const percentage = (count / digits.length) * 100;
                    
                    if (percentage < minPercentage) {
                        minPercentage = percentage;
                        lowestDigit = i;
                    }
                    if (percentage > maxPercentage) {
                        maxPercentage = percentage;
                        highestDigit = i;
                    }
                }
            }
            LWD = -1;
            HWD = -1;

            for (let i = 0; i < 10; i++) {
                const count = digitCounts[i] || 0;
                const percentage = digits.length > 0 ? ((count / digits.length) * 100).toFixed(2) : 0;
                percentageSummary += `${i}: ${percentage}% `;

                let barColorClass = 'bg-cyan-500'; // Default color
                if (digits.length > 0) { // Only apply special colors if there's data
                    if (i === lowestDigit) {
                        LWD = i;
                        barColorClass = 'bg-red-500';
                    } else if (i === highestDigit) {
                        HWD = i;
                        barColorClass = 'bg-green-500';
                    }
                    if (i === lowestDigit || i === highestDigit) {
                        if(i <= 3) LowPercentage = true
                        else LowPercentage = false
                    }
                }
                
                // const barElement = document.createElement('div');
                // barElement.className = 'flex items-center space-x-3';
                // barElement.innerHTML = `
                //     <div class="w-8 font-bold text-lg text-white">${i}</div>
                //     <div class="flex-1 bg-gray-700 rounded-full h-6">
                //         <div class="${barColorClass} h-6 rounded-full text-xs font-medium text-blue-900 text-center p-1 leading-none" style="width: ${percentage > 0 ? percentage : 0}%">${percentage > 5 ? percentage+'%' : ''}</div>
                //     </div>
                //     <div class="w-16 text-right text-gray-400 text-sm">(${count})</div>
                // `;

                // Scale the bar width for better visualization
                const scaledPercentage = Math.min(percentage * 6, 100);

                const barElement = document.createElement('div');
                barElement.className = 'flex items-center space-x-3';
                barElement.innerHTML = `
                    <div class="w-8 font-bold text-lg text-white">${i}</div>
                    <div class="flex-1 bg-gray-700 rounded-full h-6">
                        <div class="${barColorClass} h-6 rounded-full text-xs font-medium text-blue-900 text-center p-1 leading-none" style="width: ${scaledPercentage}%">${percentage > 0 ? percentage+'%' : ''}</div>
                    </div>
                    <div class="w-16 text-right text-gray-400 text-sm">(${count})</div>
                `;
                chartElement.appendChild(barElement);
            }
            summaryElement.textContent += ` ${percentageSummary}`;
            // logMessage(`------------------`, 'info');
            logMessage(`LWD: ${LWD} --- HWD: ${HWD}`, 'info');
            // logMessage(`------------------`, 'info');
        }

        function runPredictionModel(digits) {
            if (digits.length === 0) {
                return {
                    digitSequence: ['?', '?', '?'],
                    evenOddPrediction: '?',
                    digitFrequencies: new Array(10).fill(0),
                    evenCount: 0,
                    oddCount: 0,
                    totalDigits: 0
                };
            }

            const transitions = {};
            for (let i = 0; i < 10; i++) {
                transitions[i] = {};
                for (let j = 0; j < 10; j++) {
                    transitions[i][j] = 0;
                }
            }

            const digitFrequencies = new Array(10).fill(0);
            let evenCount = 0;
            let oddCount = 0;
            const totalDigits = digits.length;

            digits.forEach(digitStr => {
                const digit = parseInt(digitStr);
                if (!isNaN(digit)) {
                    if (digit % 2 === 0) {
                        evenCount++;
                    } else {
                        oddCount++;
                    }
                    digitFrequencies[digit]++;
                }
            });

            for (let i = 0; i < digits.length; i++) {
                if (i < digits.length - 1) {
                    const currentDigit = parseInt(digits[i]);
                    const nextDigit = parseInt(digits[i+1]);
                    if (!isNaN(currentDigit) && !isNaN(nextDigit)) {
                        transitions[currentDigit][nextDigit]++;
                    }
                }
            }

            let lastKnownDigit = parseInt(digits[digits.length - 1]);
            if (isNaN(lastKnownDigit)) { 
                 lastKnownDigit = 0; 
            }

            const predictedDigitSequence = [];
            let currentPredictedDigit = lastKnownDigit;

            for (let i = 0; i < 3; i++) {
                const possibleNext = transitions[currentPredictedDigit];
                let mostLikelyNext = '?';
                
                let maxCount = -1;
                if (possibleNext && typeof possibleNext === 'object') {
                    for (const digitKey in possibleNext) {
                        const count = possibleNext[digitKey];
                        if (count > maxCount) {
                            maxCount = count;
                            mostLikelyNext = digitKey;
                        }
                    }
                }

                if ((maxCount <= 1 && digits.length > 0) || !possibleNext) {
                    let maxFreq = -1;
                    for (let digit = 0; digit < digitFrequencies.length; digit++) {
                        if (digitFrequencies[digit] > maxFreq) {
                            maxFreq = digitFrequencies[digit];
                            mostLikelyNext = digit.toString();
                        }
                    }
                }
                
                predictedDigitSequence.push(mostLikelyNext);
                currentPredictedDigit = parseInt(mostLikelyNext);
                if (isNaN(currentPredictedDigit)) {
                    currentPredictedDigit = 0; 
                }
            }

            const evenOddPrediction = evenCount > oddCount ? 'EVEN' : (oddCount > evenCount ? 'ODD' : '?');

            return {
                digitSequence: predictedDigitSequence,
                evenOddPrediction: evenOddPrediction,
                digitFrequencies: digitFrequencies,
                evenCount: evenCount,
                oddCount: oddCount,
                totalDigits: totalDigits
            };
        }
        
        // --- Trading Bot Logic ---
        function startBot() {
            if (!isAuthenticated || allTickHistory.length === 0) {
                logMessage('Cannot start bot: Not authenticated or no tick history.', 'error');
                return;
            }
            isBotRunning = true;
            isWaitingForTradeProposal = false;
            isWaitingForTradeOutcome = false; // Reset for a fresh start
            stopBotBtn.disabled = false;
            startBotBtn.disabled = true;
            fetchDataBtn.disabled = true;
            updateStatus('Bot Running', 'cyan', true);
            logMessage('Bot started. Requesting trade proposal...', 'success');
            fetchData();
            //requestTradeProposal(); // Initiate the first trade cycle
        }

        function stopBot() {
            isBotRunning = false;
            isWaitingForTradeOutcome = false; // Reset on stop
            isWaitingForTradeProposal = false; // Reset on stop
            stopBotBtn.disabled = true;
            startBotBtn.disabled = false;
            fetchDataBtn.disabled = false;
            updateStatus(`Logged in as ${accountSelect.value}`, 'green');
            logMessage('Bot stopped by user. Updating analysis UI.', 'info');
        }

        // Sends a proposal request to the Deriv API
        function requestTradeProposal(proposalRequest) {
            if (!isBotRunning) {
                logMessage('Bot is not running. Not requesting trade proposal.', 'info');
                return;
            }
            if (isWaitingForTradeOutcome) {
                logMessage('Bot is already waiting for a trade outcome. Skipping new proposal request.', 'info');
                return;
            }
            if (isWaitingForTradeProposal) {
                logMessage('Bot is already waiting for a trade proposal. Skipping new proposal request.', 'info');
                return;
            }
            if (!proposalRequest) {
                logMessage('No proposal request provided. Cannot proceed.', 'error');
                return;
            }
            else{
                logMessage(`Requesting trade proposal with params: ${JSON.stringify(proposalRequest)}`, 'api');
                // Send the proposal request to the WebSocket server
                websocket.send(JSON.stringify(proposalRequest));
                foundTradeConditions = false;
                isWaitingForTradeProposal = true;  
            }
        }

        function sendBuyOrder(proposalId, price) {
            const buyRequest = {
                buy: proposalId,
                price: price,
            };

            logMessage(`Sending BUY order for proposal ID: ${proposalId} at price: ${price}`, 'info');
            websocket.send(JSON.stringify(buyRequest));
        }

        function renderTradeHistory() {
            tradesList.innerHTML = '';

            let tradesToDisplay = tradeHistory;
            const numToShow = numTradesToShowSelect.value;

            if (numToShow !== 'all') {
                // Ensure we only slice if there's enough data
                tradesToDisplay = tradeHistory.slice(0, parseInt(numToShow));
            }

            if (tradesToDisplay.length === 0) {
                tradesList.innerHTML = '<div class="text-center text-gray-500 py-4">No trades yet.</div>';
                renderProfitChart([]); // Clear chart if no trades
                return;
            }

            tradesToDisplay.forEach(trade => {
                const tradeElement = document.createElement('div');
                tradeElement.className = 'trade-item';
                
                // Determine display for Result and Total Profit/Loss
                let resultText;
                let resultColor;
                let profitText;
                let profitColor;
                // logMessage(`Processing trade: ${JSON.stringify(trade)}`, 'info');

                if (trade.result === 'Won') {
                    resultText = 'Won';
                    resultColor = 'text-green-500';
                    profitText = `${trade.profit.toFixed(2)} USD`;
                    profitColor = 'text-green-500';
                    
                } else if (trade.result === 'Lost') {
                    resultText = 'Lost';
                    resultColor = 'text-red-500';
                    profitText = `${trade.profit.toFixed(2)} USD`; // Display negative stake value
                    profitColor = 'text-red-500';
                    
                } else { // Open trades
                    resultText = 'Open';
                    resultColor = 'text-yellow-500';
                    profitText = '---';
                    profitColor = 'text-gray-300';
                }

                tradeElement.innerHTML = `
                    <div class="text-xs text-blue-300">${trade.type.replace('DIGIT', '')}</div>
                    <div class="text-xs text-gray-400">${trade.id}</div>
                    <div class="text-xs text-gray-400">${trade.timestamp}</div>
                    <div class="text-sm text-gray-300">${trade.stake.toFixed(2)}</div>
                    <div class="text-sm font-bold ${resultColor}">${resultText}</div> <div class="text-sm font-bold ${profitColor}">${profitText}</div>
                `;
                tradesList.appendChild(tradeElement);
            });

            // Render the profit chart after rendering trades
            renderProfitChart(tradesToDisplay);
        }

        // 3. Profit chart rendering logic
    let profitChart; // Chart.js instance

    function renderProfitChart(trades) {
        const ctx = document.getElementById('profit-chart').getContext('2d');
        if (!trades || trades.length === 0) {
            if (profitChart) profitChart.destroy();
            return;
        }

        // Prepare data: cumulative profit over time
        let labels = [];
        let data = [];
        let cumulativeProfit = 0;
        trades.slice().reverse().forEach(trade => {
            cumulativeProfit += trade.profit;
            labels.push(trade.timestamp);
            data.push(cumulativeProfit);
        });

        // Destroy previous chart if exists
        if (profitChart) profitChart.destroy();

        profitChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Cumulative Profit (USD)',
                    data: data,
                    borderColor: 'rgb(34,197,94)',
                    backgroundColor: 'rgba(34,197,94,0.2)',
                    fill: true,
                    tension: 0.2,
                    pointRadius: 2,
                }]
            },
            options: {
                plugins: {
                    legend: { display: true }
                },
                scales: {
                    x: { title: { display: true, text: 'Time' } },
                    y: { title: { display: true, text: 'Profit (USD)' } }
                }
            }
        });
    }

        function checkPercentageForTrade() {
            // logMessage(`Lowest Digit For All: ${myAlowestDigit}`, 'info');
            //     logMessage(`Highest Digit For All: ${myAhighestDigit}`, 'info');
            //     logMessage(`Lowest Digit For Custom List: ${myClowestDigit}`, 'info');
            //     logMessage(`Highest Digit For Custom List: ${myChighestDigit}`, 'info');
            //     logMessage(`time Now: ${Date.now()}`, 'info');
            //     logMessage(`Elapsed Time: ${Date.now() -   lastPercentageCheck}`, 'info');

                // Check if all lowest/highest digits are NOT below 3
                // if (Date.now() - lastPercentageCheck > 10000){
                    // logMessage('Resetting Index Percentage Timer.', 'info');
                    lastPercentageCheck = Date.now();
                    if(
                    typeof myAlowestDigit === "number" && typeof myAhighestDigit === "number" &&
                    typeof myClowestDigit === "number" && typeof myChighestDigit === "number"
                ) {
                    if(
                    myAlowestDigit <= 3 || myAhighestDigit <= 3 ||
                    myClowestDigit <= 3 || myChighestDigit <= 3
                ) {
                    
                    // Switch to the next volatility index in the dropdown
                    const currentIndex = syntheticIndexSelect.selectedIndex;
                    const totalOptions = syntheticIndexSelect.options.length;
                    const nextIndex = (currentIndex + 1) % totalOptions;
                    syntheticIndexSelect.selectedIndex = nextIndex;

                    // Update the label (if you want to show it somewhere else, update that element too)
                    logMessage(`All lowest/highest digits <= 3. Switching volatility index to: ${syntheticIndexSelect.options[nextIndex].text}`, 'update');

                    // Optionally, trigger a fetch for new data
                    // fetchData();
                    // return false; // Indicate that an index switch was made
                }

                else{
                    // logMessage('All lowest/highest digits are above 3. No index switch needed.', 'info');
                    waitingForServerRes = true;
                    getPredicitonNTrade();
                    waitingForServerRes = false
                    // return true;
                }
            }
        }
        // }

        function getPredicitonNTrade(){
            let mypredRequest = {"index_name": symbol}
            // Send last digits to local server at http://localhost:5000
            // logMessage('=====>Sending last digits to local server for prediction...', 'info');
            fetch('http://127.0.0.1:5001/receive', {
            //fetch('https://3wzlrmz8-5000.uks1.devtunnels.ms/receive', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(mypredRequest)
                // body: JSON.stringify(formattedData)
            })
            .then(response => response.json())
            .then(data => {
                logMessage('Successfully sent digits to local server.', 'success');
                logMessage(`Server Response: ${JSON.stringify(data)}`, 'info');
                prediction_output = JSON.stringify(data);
                prediction_output = JSON.parse(prediction_output);
                MA = prediction_output.mostAppearing;
                LA = prediction_output.smallestNumberAppearing;
                AP = (prediction_output.probability_all_over_3)* 100; // Convert to percentage
                durationWhole = prediction_output.duration_ms;
                durationPrediction = prediction_output.prediction_ms;
                logMessage(`Prediction Duration Whole: ${durationWhole} ms, Prediction Duration Prediction: ${durationPrediction} ms`, 'update');
                logMessage(`Prediction MA: ${MA}, LA: ${LA}, AP: ${(AP).toFixed(2)}%`, 'update');
                // MA = prediction_output.mostAppearing;
                // LA = prediction_output.smallestNumberAppearing;
                // AP = prediction_output.percentage;
                // logMessage(`Prediction MA: ${MA} , Prediction LA: ${LA} , Prediction OP: ${AP}`, 'update');
                
            })
            .catch(error => {
                logMessage(`Error sending digits to local server: ${error}`, 'error');
            });

            if (selectedTradeType === 'Bot') {
                let detailsHtml = 'Highest Confidence Trades:<br>';
                let logDetails = 'Bot Decision Confidences:\n';

                // Use the prediction values from the local server (MA, LA, AP)
                detailsHtml += `OVER 3 (<span class="text-yellow-300">MA: ${MA}, LA: ${LA}, AP: ${(AP * 100).toFixed(2)}%</span>)<br>`;
                logDetails += `- OVER 3 (MA: ${MA}, LA: ${LA}, AP: ${(AP * 100).toFixed(2)}%)\n`;

                predictionDetails.innerHTML = detailsHtml;
                logMessage(logDetails, 'info');

                // Place trade if conditions are met
                // Get AP threshold from user input (default 0.3)
                const apThresholdInput = document.getElementById('ap-threshold');
                let apThreshold = 0.8;
                if(AP > 12.0){
                // if (apThresholdInput && !isNaN(parseFloat(apThresholdInput.value))) {
                //     apThreshold = parseFloat(apThresholdInput.value);
                //     }
                // if (MA > 3 && LA > 3 && AP > apThreshold && !LowPercentage && !isWaitingForTradeOutcome) {
                //         logMessage(`Bot condition met: Placing OVER 3 trade (AP threshold: ${apThreshold}).`, 'success');
                //         // Prepare contract params for OVER 3
                        const selectedTradeTypeForBot = 'DIGITOVER'; // Always use OVER for Bot trades
                        const predictedValue = 2;
                        const contractTypeSpecificParams = { barrier: 2};
                        let myStake = 0;
                        let martingaleValue = parseInt(martingaleValueSelect.value) || 1;
                    if(martingaleNow){
                        myStake = (martingaleValue * martingaleStage * parseFloat(stakeAmountInput.value)).toFixed(2);
                        // logMessage(`Martingale active: Using ${martingaleValue}x stake of ${myStake} for this trade.`, 'info');
                    } else {
                        myStake = parseFloat(stakeAmountInput.value).toFixed(2);
                        // logMessage(`Using normal stake of ${myStake} for this trade.`, 'info');
                    }
                     proposalRequest = {
                        proposal: 1,
                        amount: parseFloat(myStake),
                        basis: "stake",
                        contract_type: selectedTradeTypeForBot,
                        currency: "USD",
                        duration: parseInt(tradeTickDurationSelect.value),
                        duration_unit: "t",
                        symbol: syntheticIndexSelect.value,
                        ...contractTypeSpecificParams,
                        subscribe: 1
                    };
                    // logMessage(`Requesting trade proposal with params: ${JSON.stringify(proposalRequest)}`, 'api');
                    foundTradeConditions = true;
                    AP = 0; // Reset AP after placing trade
                    requestTradeProposal(proposalRequest);
                    // isWaitingForTradeOutcome = true;
                    //websocket.send(JSON.stringify(proposalRequest));
                } 
                else {
                    // logMessage('Bot condition NOT met: No trade placed.', 'info');
                    predictionDetails.innerHTML += '<span class="text-yellow-300">No trade placed: Prediction confidence too low.</span>';
                }
   
            }
            else { // Manual trade type selection (not Bot)
                let displayPredictedValue = '--';
                let displayConfidence = 0; 
                let displayPreferredTradeType = selectedTradeType;

                const predictedDigit = parseInt(predictionData.digitSequence[0]);
                displayPredictedValue = isNaN(predictedDigit) ? '--' : predictedDigit;
                displayConfidence = (predictionData.digitFrequencies[predictedDigit] / predictionData.totalDigits * 100);
            
        }
  
        }


        // --- UI & Helper Functions ---
        function resetAppState(cause) {
            logMessage(`Resetting application state..., ${cause}`, 'error');
            isAuthenticated = false;
            isBotRunning = false;
            isWaitingForTradeOutcome = false; // Reset on app state reset
            isWaitingForTradeProposal = false; // Reset on app state reset
            foundTradeConditions = false;
            accounts = [];
            tickHistory = [];
            allTickHistory = [];
            tradeHistory = [];
            currentProposal = null;
            stopPinging();
            
            updateStatus('Disconnected', 'red');
            apiTokenInput.disabled = false;
            appIdInput.disabled = false;
            connectBtn.textContent = 'Connect';
            connectBtn.classList.replace('bg-blue-600', 'bg-red-600');
            connectBtn.classList.replace('hover:bg-blue-700', 'hover:bg-red-700');
            
            accountSelectionCard.classList.add('hidden');
            botControlsCard.classList.add('hidden');
            predictionCard.classList.add('hidden');
            startBotBtn.disabled = true;
            stopBotBtn.disabled = true;
            fetchDataBtn.disabled = false;
            accountBalance.textContent = 'Balance: ---';
            
            digitChart1000.innerHTML = '';
            analysisSummary1000.textContent = 'Fetch data to see distribution.';
            digitChartCustom.innerHTML = '';
            analysisSummaryCustom.textContent = 'Fetch data to see distribution.';
            predictionSequence.textContent = '[ ? ? ? ]';
            predictionDetails.innerHTML = 'Predicted Value: --, Confidence: --%, Type: --'; // Use innerHTML for potential spans
            renderTradeHistory();
            logMessage('Application state reset.', 'info');
        }

        function updateStatus(text, color, isBlinking = false) {
            statusText.textContent = text;
            statusLight.className = `w-4 h-4 rounded-full bg-${color}-500`;
            statusLight.classList.toggle('blinking', isBlinking);
        }

        // Autoscroll logic
        const logsAutoscrollCheckbox = document.getElementById('logs-autoscroll');
        let logsAutoscrollEnabled = true;
        logsAutoscrollCheckbox.addEventListener('change', () => {
            logsAutoscrollEnabled = logsAutoscrollCheckbox.checked;
        });

        function logMessage(message, type = 'info') {
            const logElement = document.createElement('div');
            logElement.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
            logElement.className = `log-message log-${type}`;
            logsContainer.appendChild(logElement);
            if (logsAutoscrollEnabled) {
                logsContainer.scrollTop = logsContainer.scrollHeight;
            }
        }
        
        // --- Event Listeners ---
        connectBtn.addEventListener('click', () => {
            if (isAuthenticated) websocket.close();
            else connect();
        });
        
        togglePasswordBtn.addEventListener('click', () => {
            const isPassword = apiTokenInput.type === 'password';
            apiTokenInput.type = isPassword ? 'text' : 'password';
            eyeIcon.classList.toggle('hidden', isPassword);
            eyeOffIcon.classList.toggle('hidden', !isPassword);
        });

        accountSelect.addEventListener('change', () => {
            const selectedAccountLoginId = accountSelect.value;
            websocket.send(JSON.stringify({ authorize: currentApiToken, switch_account: selectedAccountLoginId }));
            logMessage(`Attempting to switch to account ${selectedAccountLoginId}. Waiting for authorization response to update balance.`, 'info');
        });
        
        syntheticIndexSelect.addEventListener('change', () => {
            if (isAuthenticated) {
                allTickHistory = [];
                tickHistory = [];
                logMessage(`Market changed to ${syntheticIndexSelect.value}. Please 'Fetch & Analyze' for new data.`, 'info');
                startBotBtn.disabled = true;
                subscribeToTicks(syntheticIndexSelect.value);
            }
        });

        totalHistoricalTicksSelect.addEventListener('change', fetchData);
        
        tradeTypeSelect.addEventListener('change', () => {
            if (isBotRunning) {
                logMessage('Cannot change trade type while bot is running. Please stop the bot first.', 'error');
                // Revert selection if bot is running
                const previousValue = tradeTypeSelect.dataset.previousValue || 'Bot';
                tradeTypeSelect.value = previousValue;
            } else {
                tradeTypeSelect.dataset.previousValue = tradeTypeSelect.value; // Store current value
            }
        });
        // Store initial value
        tradeTypeSelect.dataset.previousValue = tradeTypeSelect.value;

        fetchDataBtn.addEventListener('click', fetchData);
        customTickCountSelect.addEventListener('change', runCustomAnalysis);
        startBotBtn.addEventListener('click', startBot);
        stopBotBtn.addEventListener('click', stopBot);

        numTradesToShowSelect.addEventListener('change', fetchTradeHistoryFromAPI); // Call fetchTradeHistoryFromAPI on dropdown change

        clearLogsBtn.addEventListener('click', () => {
            logsContainer.innerHTML = '';
            logMessage('Logs cleared.', 'info');
        });

        // --- Initial State ---
        // resetAppState();
        logMessage("Welcome! Please enter your API token and optional App ID to connect.", 'info');

    