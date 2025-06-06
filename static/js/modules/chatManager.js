/**
 * Chat Manager Module
 * Handles chat functionality using WebSockets with sessionStorage persistence
 */

import { app, MOBILE_DEVICE } from '../core/app.js';
import { isSafeToToggleFullscreen } from './fullscreenManager.js';

// Session storage keys
const STORAGE_KEY = 'ghosthub_chat_messages';
const STORAGE_TIMESTAMP_KEY = 'ghosthub_chat_timestamp';
const STORAGE_JOINED_KEY = 'ghosthub_chat_joined';

// Chat state
const chatState = {
    isExpanded: false,
    messages: [],
    maxMessages: 50, // Maximum number of messages to keep in memory
    unreadCount: 0,
    isJoined: false
};

// DOM elements (will be initialized later)
let chatContainer = null;
let chatMessages = null;
let chatInput = null;
let chatToggle = null;
let chatForm = null;
let latestMessage = null;
let chatHeader = null;

// Dragging state
let isDragging = false;
let initialX = 0;
let initialY = 0;
let offsetX = 0;
let offsetY = 0;
let dragDistance = 0; // Track drag distance to distinguish between drag and click
let touchStartTime = 0; // Track touch start time for tap detection
let isTouchClick = false; // Flag to indicate if a touch was a click

// Socket reference (will use the existing socket connection)
let socket = null;

/**
 * Initialize the chat module
 * @param {Object} socketInstance - The existing socket.io instance
 */
function initChat(socketInstance) {
    if (!socketInstance) {
        console.error('Chat initialization failed: No socket instance provided');
        return;
    }
    
    socket = socketInstance;
    
    // Initialize DOM references - use existing elements from index.html
    chatContainer = document.getElementById('chat-container');
    chatMessages = document.getElementById('chat-messages');
    chatInput = document.getElementById('chat-input');
    chatToggle = document.getElementById('chat-toggle');
    chatForm = document.getElementById('chat-form');
    latestMessage = document.getElementById('latest-message');
    chatHeader = document.getElementById('chat-header');
    
    // Check if all elements exist
    if (!chatContainer || !chatMessages || !chatInput || !chatToggle || !chatForm || !latestMessage || !chatHeader) {
        console.error('Chat initialization failed: Missing UI elements');
        console.log('Missing elements:', {
            chatContainer: !!chatContainer,
            chatMessages: !!chatMessages,
            chatInput: !!chatInput,
            chatToggle: !!chatToggle,
            chatForm: !!chatForm,
            latestMessage: !!latestMessage,
            chatHeader: !!chatHeader
        });
        return;
    }
    
    console.log('Chat UI elements found successfully');
    
    // Set up event listeners
    setupEventListeners();
    
    // Set up socket event handlers
    setupSocketHandlers();
    
    // Set up draggable functionality
    setupDraggable();
    
    // Load chat history from localStorage
    loadChatHistory();

    // Remove the beforeunload handler as sessionStorage handles clearing automatically
    // setupBeforeUnloadHandler();

    // Join the chat room
    joinChat();
    
    console.log('Chat module initialized with localStorage persistence');
}

/**
 * Set up the beforeunload event handler to clear chat history when tab/window is closed
 */
/* // Remove the beforeunload handler as sessionStorage handles clearing automatically
function setupBeforeUnloadHandler() {
    window.addEventListener('beforeunload', () => {
        // Clear chat history from localStorage when the tab/window is closed
        clearChatHistory();
        console.log('Chat history cleared on page unload');
    });
}
*/

/**
 * Load chat history from sessionStorage
 */
function loadChatHistory() {
    try {
        const savedMessages = sessionStorage.getItem(STORAGE_KEY); // Use sessionStorage
        if (savedMessages) {
            const parsedMessages = JSON.parse(savedMessages);
            
            // Validate the parsed data is an array
            if (Array.isArray(parsedMessages)) {
                // Add each message to the chat
                parsedMessages.forEach(msg => {
                    // Skip adding the message to the messages array since addMessageToDOM will do that
                    addMessageToDOM(msg, false);
                });
                
                // Update chat state
                chatState.messages = parsedMessages;
                
                // Update latest message display if there are messages
                if (parsedMessages.length > 0) {
                    updateLatestMessage(parsedMessages[parsedMessages.length - 1].message);
                }

                console.log(`Loaded ${parsedMessages.length} messages from sessionStorage`); // Log sessionStorage

                // Scroll to bottom if chat is expanded
                if (chatState.isExpanded) {
                    scrollToBottom();
                }
            }
        }
    } catch (error) {
        console.error('Error loading chat history from sessionStorage:', error); // Log sessionStorage
        // If there's an error, clear the sessionStorage to prevent future errors
        clearChatHistory();
    }
}

/**
 * Save chat history to sessionStorage
 */
function saveChatHistory() {
    try {
        // Save messages to sessionStorage
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(chatState.messages)); // Use sessionStorage

        // Save timestamp of when the messages were saved
        sessionStorage.setItem(STORAGE_TIMESTAMP_KEY, Date.now().toString()); // Use sessionStorage
    } catch (error) {
        console.error('Error saving chat history to sessionStorage:', error); // Log sessionStorage
    }
}

/**
 * Clear chat history from sessionStorage
 */
function clearChatHistory() {
    try {
        sessionStorage.removeItem(STORAGE_KEY); // Use sessionStorage
        sessionStorage.removeItem(STORAGE_TIMESTAMP_KEY); // Use sessionStorage
    } catch (error) {
        console.error('Error clearing chat history from sessionStorage:', error); // Log sessionStorage
    }
}

// Function removed as we're using the existing chat UI from index.html

/**
 * Set up event listeners for chat UI elements
 */
function setupEventListeners() {
    // Toggle chat expansion when clicking the toggle button
    chatToggle.addEventListener('click', (e) => {
        // Prevent event from bubbling up to document
        e.stopPropagation();
        // Prevent default behavior
        e.preventDefault();
        // Toggle chat
        toggleChat();
    });
    
    // Toggle chat expansion when clicking the header (for desktop)
    chatHeader.addEventListener('click', (e) => {
        // Don't toggle if clicking directly on the toggle button (it has its own handler)
        if (!e.target.closest('#chat-toggle')) {
            // Only toggle if not dragging or if drag distance is small (click vs drag)
            if (!isDragging || dragDistance < 5) {
                // Prevent event from bubbling up to document
                e.stopPropagation();
                // Prevent default behavior
                e.preventDefault();
                // Toggle chat
                toggleChat();
            }
        }
    });
    
    // Add a specific touchend handler for the chat header (for mobile)
    chatHeader.addEventListener('touchend', (e) => {
        // Don't toggle if touching the toggle button (it has its own handler)
        if (!e.target.closest('#chat-toggle')) {
            // Only toggle if it was a tap (short touch with minimal movement)
            if (isTouchClick) {
                console.log('Touch click detected on header');
                // Prevent event from bubbling up to document
                e.stopPropagation();
                // Prevent default behavior
                e.preventDefault();
                // Toggle chat
                toggleChat();
            }
        }
    });
    
    // Submit message on form submit
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMessage();
    });
    
    // Auto-collapse chat when clicking outside
    document.addEventListener('click', (e) => {
        if (chatState.isExpanded && 
            !chatContainer.contains(e.target) && 
            !e.target.closest('#chat-container')) {
            collapseChat();
        }
    });
    
    // Prevent clicks inside chat from propagating to document
    chatContainer.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}

/**
 * Set up draggable functionality for the chat container
 */
function setupDraggable() {
    // Mouse events
    chatHeader.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', stopDrag);
    
    // Touch events for mobile
    chatHeader.addEventListener('touchstart', startDragTouch);
    document.addEventListener('touchmove', dragTouch);
    document.addEventListener('touchend', stopDragTouch);
}

/**
 * Start dragging (mouse event)
 * @param {MouseEvent} e - The mouse event
 */
function startDrag(e) {
    // Don't start drag if clicking on the toggle button
    if (e.target.closest('#chat-toggle')) return;
    
    // Reset drag distance
    dragDistance = 0;
    
    // Set dragging state
    isDragging = true;
    
    // Get initial mouse position
    initialX = e.clientX;
    initialY = e.clientY;
    
    // Get current container position
    const rect = chatContainer.getBoundingClientRect();
    offsetX = initialX - rect.left;
    offsetY = initialY - rect.top;
    
    // Add active class for styling
    chatContainer.classList.add('dragging');
    
    // Prevent default behavior
    e.preventDefault();
    e.stopPropagation();
    
    // Prevent page scrolling during drag
    document.body.style.overflow = 'hidden';
}

/**
 * Start dragging (touch event)
 * @param {TouchEvent} e - The touch event
 */
function startDragTouch(e) {
    // Don't start drag if touching the toggle button
    if (e.target.closest('#chat-toggle')) return;
    
    if (e.touches.length === 1) {
        // Reset drag distance and touch click flag
        dragDistance = 0;
        isTouchClick = true;
        touchStartTime = Date.now();
        
        // Set dragging state
        isDragging = true;
        
        // Get initial touch position
        initialX = e.touches[0].clientX;
        initialY = e.touches[0].clientY;
        
        // Get current container position
        const rect = chatContainer.getBoundingClientRect();
        offsetX = initialX - rect.left;
        offsetY = initialY - rect.top;
        
        // Add active class for styling
        chatContainer.classList.add('dragging');
        
        // Prevent default behavior
        e.preventDefault();
        e.stopPropagation();
        
        // Prevent page scrolling during drag
        document.body.style.overflow = 'hidden';
    }
}

/**
 * Drag the container (mouse event)
 * @param {MouseEvent} e - The mouse event
 */
function drag(e) {
    if (!isDragging) return;
    
    // Calculate drag distance
    const dx = e.clientX - initialX;
    const dy = e.clientY - initialY;
    dragDistance = Math.sqrt(dx * dx + dy * dy);
    
    // If drag distance is significant, it's not a click
    if (dragDistance > 5) {
        isTouchClick = false;
    }
    
    // Calculate new position
    const x = e.clientX - offsetX;
    const y = e.clientY - offsetY;
    
    // Apply new position
    updatePosition(x, y);
    
    // Prevent default behavior
    e.preventDefault();
    e.stopPropagation();
}

/**
 * Drag the container (touch event)
 * @param {TouchEvent} e - The touch event
 */
function dragTouch(e) {
    if (!isDragging || e.touches.length !== 1) return;
    
    // Calculate drag distance
    const dx = e.touches[0].clientX - initialX;
    const dy = e.touches[0].clientY - initialY;
    dragDistance = Math.sqrt(dx * dx + dy * dy);
    
    // If drag distance is significant, it's not a click
    if (dragDistance > 5) {
        isTouchClick = false;
    }
    
    // Calculate new position
    const x = e.touches[0].clientX - offsetX;
    const y = e.touches[0].clientY - offsetY;
    
    // Apply new position
    updatePosition(x, y);
    
    // Prevent default behavior
    e.preventDefault();
    e.stopPropagation();
}

/**
 * Update the container position
 * @param {number} x - The x position
 * @param {number} y - The y position
 */
function updatePosition(x, y) {
    // Get viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Get container dimensions
    const containerWidth = chatContainer.offsetWidth;
    const containerHeight = chatContainer.offsetHeight;
    
    // Constrain position to viewport
    const constrainedX = Math.max(0, Math.min(x, viewportWidth - containerWidth));
    const constrainedY = Math.max(0, Math.min(y, viewportHeight - containerHeight));
    
    // Apply position
    chatContainer.style.left = `${constrainedX}px`;
    chatContainer.style.top = `${constrainedY}px`;
    
    // Remove bottom/right positioning
    chatContainer.style.bottom = 'auto';
    chatContainer.style.right = 'auto';
}

/**
 * Stop dragging (mouse event)
 */
function stopDrag() {
    if (!isDragging) return;
    
    // If drag distance is small, treat it as a click
    if (dragDistance < 5) {
        console.log('Treating as click, not drag');
        // We'll let the click handler handle this
    }
    
    // Reset dragging state
    isDragging = false;
    
    // Remove active class
    chatContainer.classList.remove('dragging');
    
    // Restore page scrolling
    document.body.style.overflow = '';
    
    // Small delay before allowing clicks to prevent accidental clicks after drag
    setTimeout(() => {
        dragDistance = 0;
    }, 100);
}

/**
 * Stop dragging (touch event)
 * @param {TouchEvent} e - The touch event
 */
function stopDragTouch(e) {
    if (!isDragging) return;
    
    // Calculate touch duration
    const touchDuration = Date.now() - touchStartTime;
    
    // If drag distance is small and touch duration is short, treat it as a tap
    if (dragDistance < 5 && touchDuration < 300) {
        console.log('Treating as tap, not drag');
        isTouchClick = true;
    } else {
        isTouchClick = false;
    }
    
    // Reset dragging state
    isDragging = false;
    
    // Remove active class
    chatContainer.classList.remove('dragging');
    
    // Restore page scrolling
    document.body.style.overflow = '';
    
    // Small delay before allowing clicks to prevent accidental clicks after drag
    setTimeout(() => {
        dragDistance = 0;
    }, 100);
}

/**
 * Set up socket event handlers for chat
 */
function setupSocketHandlers() {
    // Handle incoming chat messages
    socket.on('chat_message', (data) => {
        addMessage(data);
    });
    
    // Handle chat notifications (join/leave)
    socket.on('chat_notification', (data) => {
        addNotification(data);
    });
}

/**
 * Join the chat room
 */
function joinChat() {
    if (!socket || chatState.isJoined) return;
    
    // Check if user has already joined in this session (i.e., this is a refresh)
    const hasJoined = sessionStorage.getItem(STORAGE_JOINED_KEY) === 'true';
    
    if (hasJoined) {
        // This is a refresh - emit a special event that won't trigger a notification
        socket.emit('rejoin_chat');  // Matches SE['REJOIN_CHAT'] in constants.py
        console.log('Rejoined chat room after refresh (no notification sent)');
    } else {
        // This is a new join - emit the regular join event
        socket.emit('join_chat');  // Matches SE['JOIN_CHAT'] in constants.py
        console.log('Joined chat room for the first time (notification sent)');
        
        // Store join status in sessionStorage to track refreshes
        sessionStorage.setItem(STORAGE_JOINED_KEY, 'true');
    }
    
    chatState.isJoined = true;
}

/**
 * Leave the chat room
 */
function leaveChat() {
    if (!socket || !chatState.isJoined) return;
    
    socket.emit('leave_chat');
    chatState.isJoined = false;
    console.log('Left chat room');
}

/**
 * Toggle chat expansion state
 */
function toggleChat() {
    // Check if it's safe to interact with the chat (not immediately after exiting fullscreen)
    if (!isSafeToToggleFullscreen()) {
        console.log('Delaying chat toggle to prevent fullscreen issues');
        // Delay the toggle to prevent fullscreen issues
        setTimeout(() => {
            performChatToggle();
        }, 300);
        return;
    }
    
    performChatToggle();
}

/**
 * Perform the actual chat toggle operation
 */
function performChatToggle() {
    // Ensure we're not in fullscreen mode when toggling chat
    const fullscreenElement = document.fullscreenElement || 
                             document.webkitFullscreenElement || 
                             document.mozFullScreenElement || 
                             document.msFullscreenElement;
    
    // If we're in fullscreen mode, don't toggle fullscreen again
    if (fullscreenElement) {
        // Just toggle the chat state without affecting fullscreen
        console.log('Toggling chat while in fullscreen mode');
    }
    
    if (chatState.isExpanded) {
        collapseChat();
    } else {
        expandChat();
    }
}

/**
 * Expand the chat container
 */
function expandChat() {
    chatContainer.classList.remove('collapsed');
    chatContainer.classList.add('expanded');
    chatState.isExpanded = true;
    chatState.unreadCount = 0;
    
    // Clear unread indicator
    chatToggle.removeAttribute('data-count');
    chatToggle.classList.remove('has-unread');
    
    // Focus the input field
    setTimeout(() => {
        chatInput.focus();
    }, 300);
    
    // Scroll to the bottom of the chat
    scrollToBottom();
}

/**
 * Collapse the chat container
 */
function collapseChat() {
    chatContainer.classList.remove('expanded');
    chatContainer.classList.add('collapsed');
    chatState.isExpanded = false;
}

/**
 * Send a chat message
 */
function sendMessage() {
    const message = chatInput.value.trim();
    
    if (!message) return;
    
    // Emit the message event
    socket.emit('chat_message', {
        message: message,
        timestamp: Date.now()
    });
    
    // Clear the input field
    chatInput.value = '';
    
    // Focus the input field again
    chatInput.focus();
}

/**
 * Add a message to the DOM
 * @param {Object} data - The message data
 * @param {boolean} saveToState - Whether to add the message to the state (default: true)
 */
function addMessageToDOM(data, saveToState = true) {
    // Create message element
    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message';
    
    // Format timestamp if provided
    let timeString = '';
    if (data.timestamp) {
        const date = new Date(data.timestamp);
        timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    // Set message content
    messageEl.innerHTML = `
        <span class="chat-user">${data.user_id || 'Unknown'}</span>
        <span class="chat-text">${escapeHTML(data.message)}</span>
        ${timeString ? `<span class="chat-time">${timeString}</span>` : ''}
    `;
    
    // Add to messages array if saveToState is true
    if (saveToState) {
        chatState.messages.push(data);
        
        // Limit the number of messages in memory
        if (chatState.messages.length > chatState.maxMessages) {
            chatState.messages.shift();
        }
        
        // Save to localStorage
        saveChatHistory();
    }
    
    // Add to DOM
    chatMessages.appendChild(messageEl);
}

/**
 * Add a notification to the DOM
 * @param {Object} data - The notification data
 * @param {boolean} saveToState - Whether to add the notification to the state (default: true)
 */
function addNotificationToDOM(data, saveToState = true) {
    // Create notification element
    const notificationEl = document.createElement('div');
    notificationEl.className = 'chat-notification';
    notificationEl.textContent = data.message;
    
    // Add to DOM
    chatMessages.appendChild(notificationEl);
    
    // Add to messages array if saveToState is true
    if (saveToState) {
        // Add a type field to distinguish notifications from messages
        const notificationData = {
            ...data,
            isNotification: true
        };
        
        chatState.messages.push(notificationData);
        
        // Limit the number of messages in memory
        if (chatState.messages.length > chatState.maxMessages) {
            chatState.messages.shift();
        }
        
        // Save to localStorage
        saveChatHistory();
    }
}

/**
 * Add a message to the chat
 * @param {Object} data - The message data
 */
function addMessage(data) {
    // Add message to DOM
    addMessageToDOM(data);
    
    // Update latest message display
    updateLatestMessage(data.message);
    
    // Increment unread count if chat is collapsed
    if (!chatState.isExpanded) {
        chatState.unreadCount++;
        updateUnreadIndicator();
    }
    
    // Scroll to bottom if chat is expanded
    if (chatState.isExpanded) {
        scrollToBottom();
    }
}

/**
 * Add a notification to the chat
 * @param {Object} data - The notification data
 */
function addNotification(data) {
    // Add notification to DOM
    addNotificationToDOM(data);
    
    // Update latest message display
    updateLatestMessage(data.message);
    
    // Increment unread count if chat is collapsed
    if (!chatState.isExpanded) {
        chatState.unreadCount++;
        updateUnreadIndicator();
    }
    
    // Scroll to bottom if chat is expanded
    if (chatState.isExpanded) {
        scrollToBottom();
    }
}

/**
 * Update the latest message display
 * @param {string} message - The message text
 */
function updateLatestMessage(message) {
    if (latestMessage) {
        latestMessage.textContent = message;
    }
}

/**
 * Update the unread message indicator
 */
function updateUnreadIndicator() {
    if (chatState.unreadCount > 0) {
        chatToggle.setAttribute('data-count', chatState.unreadCount);
        chatToggle.classList.add('has-unread');
    } else {
        chatToggle.removeAttribute('data-count');
        chatToggle.classList.remove('has-unread');
    }
}

/**
 * Scroll the chat messages to the bottom
 */
function scrollToBottom() {
    if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} text - The text to escape
 * @returns {string} - The escaped text
 */
function escapeHTML(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Export functions needed by other modules
export {
    initChat,
    joinChat,
    leaveChat,
    toggleChat
};
