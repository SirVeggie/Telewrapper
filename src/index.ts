import TelegramBot from 'node-telegram-bot-api';
import logger from './tools/logger';
import { timer } from './tools/timer';

//#region types
export interface ICommand {
    command: string;
    chatIDs: number[];
    desc: string;
    callback: (msg: TelegramBot.Message) => void;
}

export interface IKeywordCmd {
    keyword: string;
    chatIDs: number[];
    regex: RegExp;
    desc: string;
    callback: (msg: TelegramBot.Message) => void;
}

export interface IRegexCmd {
    command: string;
    chatIDs: number[];
    regex: RegExp;
    desc: string;
    callback: (msg: TelegramBot.Message) => void;
}

export interface IAnyCmd {
    chatIDs: number[];
    callback: (msg: TelegramBot.Message) => void;
}

export interface IButtonCmd {
    name: string;
    callback: (query: TelegramBot.CallbackQuery) => string | void | Promise<void>;
}
//#endregion

//#region fields/exports
const main = {
    core: null as unknown as TelegramBot,
    botInfo: null as unknown as TelegramBot.User,
    startTime: new Date(),
    messageListLength: 1000,
    validChats: [] as number[],
    debugChat: 0,

    commandList: {} as { [index: string]: ICommand; },
    buttonList: {} as { [index: string]: IButtonCmd; },
    keywordList: [] as IKeywordCmd[],
    regexCmdList: [] as IRegexCmd[],
    messageList: [] as TelegramBot.Message[],
    anyList: [] as IAnyCmd[],

    //#region function exports
    start,
    stop,
    continueFromStop,

    deleteIfMentioned,
    onKeyword,
    onAny,
    onButton,
    onCommand,
    onRegexCommand,
    extractCommand,

    sendError,
    sendMessageBase,
    sendMessage,
    sendMarkdown,
    sendMarkdownV2,
    sendReply,
    sendKeyboard,
    clearKeyboard,
    sendPoll,
    sendDice,

    kButton,
    iButton,
    newKeyboard,
    newInline,
    replaceKeyboard,
    editMessage,
    deleteMessage,
    clearMessages,
    messageEqual,
    validCommand,

    addValidChat,
    botRunningTime
    //#endregion
};
//#endregion

function start(api_key: string, debugChatId: number, ctorOptions?: TelegramBot.ConstructorOptions): void {
    main.startTime = new Date();
    main.debugChat = debugChatId;
    main.validChats = [main.debugChat];

    ctorOptions = ctorOptions ? ctorOptions : {};
    ctorOptions.polling = ctorOptions.polling ? ctorOptions.polling : true;
    main.core = new TelegramBot(api_key, ctorOptions);

    main.core.getMe().then(user => main.botInfo = user);

    botEventSubscriptions();
}

function stop(): void {
    main.core.stopPolling();
}

function continueFromStop(): void {
    main.core.startPolling();
}

//#region general
function botEventSubscriptions() {
    main.core.on('message', (msg: TelegramBot.Message) => {
        try {
            // ignore special messages
            if (!msg.text) {
                // ignore and delete pinned messages
                if (msg.pinned_message)
                    deleteMessage(msg);
                return;
            }

            // call all Any commands
            main.anyList.forEach(c => {
                if (c.chatIDs.includes(msg.chat.id)) {
                    c.callback(msg);
                }
            });

            // check and call a command
            const command = extractCommand(msg.text).toLowerCase();

            if (main.commandList[command]) {
                deleteIfMentioned(msg);
                main.commandList[command].callback(msg);
                return;
            }

            // check and call regex command
            if (msg.text && msg.text.charAt(0) == '/') {
                for (let index = 0; index < main.regexCmdList.length; index++) {
                    const cmd = main.regexCmdList[index];
                    if (cmd.regex.exec(msg.text)) {
                        deleteIfMentioned(msg);
                        cmd.callback(msg);
                        return;
                    }
                }

                return;
            }

            // check and call all matching keywords
            let found = false;

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for (const [key, value] of Object.entries(main.keywordList)) {
                if (value.regex.exec(msg.text)) {
                    value.callback(msg);
                    found = true;
                }
            }

            if (found) {
                return;
            }

            // indicator if a message was not any command in debug chat
            if (msg.chat.id == main.debugChat && main.debugChat != 0) {
                sendMessage('Not valid: ' + msg.text, main.debugChat);
            }

        } catch (error) {
            sendError('message error', error);
        }
    });

    main.core.on('callback_query', async (query: TelegramBot.CallbackQuery) => {
        try {
            let answer = '';
            if (main.buttonList[query.data!]) {
                const res = main.buttonList[query.data!].callback(query);
                if (typeof res === 'string')
                    answer = res;
            } else {
                deleteMessage(query.message);
                const msg = await sendMessage('Sorry, an error has occurred', query.message?.chat.id ?? main.debugChat);
                await timer(3000);
                deleteMessage(msg);
                return;
            }

            const options: TelegramBot.AnswerCallbackQueryOptions = {
                callback_query_id: query.id,
                text: answer ? answer.replace(/^!/, '') : undefined,
                show_alert: answer ? (answer.match(/^!/) ? true : undefined) : undefined
            };

            main.core.answerCallbackQuery(query.id, options);

        } catch (error) {
            sendError('query error with button ' + query.data, error);
        }
    });
}

function deleteIfMentioned(msg: TelegramBot.Message): void {
    if (main.botInfo == null)
        return;
    if (msg.text?.includes('@' + main.botInfo.username) || msg.reply_to_message?.from?.username === main.botInfo.username) {
        deleteMessage(msg);
    }
}

function onKeyword(keyword: string, chatIDs: number[] | number, callback: (msg: TelegramBot.Message) => void, desc: string = ''): void {
    const ids: number[] = typeof chatIDs === 'object' ? chatIDs : [chatIDs];
    const match = new RegExp(keyword, 'i');
    const action = (keywordBase as any).bind(null, chatIDs, callback);
    main.keywordList.push({ keyword: keyword, desc: desc, chatIDs: ids, regex: match, callback: action });
}

function keywordBase(chatIDs: number[], callback: (msg: TelegramBot.Message) => void, msg: TelegramBot.Message) {
    if (!validCommand(msg, chatIDs, true))
        return;
    callback(msg);
}

function onAny(chatIDs: number[] | number, callback: (msg: TelegramBot.Message) => void): void {
    const ids: number[] = typeof chatIDs === 'object' ? chatIDs : [chatIDs];
    main.anyList.push({ chatIDs: ids, callback: callback });
}

function onButton(name: string, callback: (query: TelegramBot.CallbackQuery) => string | void | Promise<void>): void {
    main.buttonList[name] = { name: name, callback: callback };
}

function onCommand(command: string, chatIDs: number[] | number, callback: (msg: TelegramBot.Message, content: string) => void, desc: string): void {
    if (command.match('\\W+')) {
        logger.log('Command \'' + command + '\' has illegal characters');
        return;
    } else if (main.commandList[command]) {
        logger.log('Command \'' + command + '\' already exists');
        return;
    }

    const ids: number[] = typeof chatIDs === 'object' ? chatIDs : [chatIDs];
    const action = commandBase.bind(null, ids, callback);
    main.commandList[command.toLocaleLowerCase()] = { command: command, desc: desc, chatIDs: ids, callback: action };
}

function commandBase(chatIDs: number[] | number, callback: (msg: TelegramBot.Message, content: string) => void, msg: TelegramBot.Message) {
    if (!validCommand(msg, chatIDs))
        return;
    const content = msg.text?.replace(/[^ ]+ ?/, '') ?? '';
    callback(msg, content);
}

function onRegexCommand(command: string, chatIDs: number[] | number, callback: (msg: TelegramBot.Message) => void, desc?: string): void {
    const ids: number[] = typeof chatIDs === 'object' ? chatIDs : [chatIDs];
    const action = regexCommandBase.bind(null, ids, callback);
    const regex = new RegExp('^/' + command, 'i');
    main.regexCmdList.push({ command: command, regex: regex, desc: desc ?? '', chatIDs: ids, callback: action });
}

function regexCommandBase(chatIDs: number[], callback: (msg: TelegramBot.Message) => void, msg: TelegramBot.Message) {
    if (!validCommand(msg, chatIDs))
        return;
    callback(msg);
}

function extractCommand(text: string): string {
    const res = new RegExp('^/\\w+').exec(text);
    if (res)
        return res[0].substring(1);
    return '';
}
//#endregion

//#region messaging
async function sendError(text: string, error: any = null): Promise<TelegramBot.Message | undefined> {
    logger.log('Error: ' + text, error);
    if (main.debugChat == 0)
        return;
    const stack = error?.stack ? '\n\n' + error.stack : error ? '\n\n' + error : '';
    return await main.core.sendMessage(main.debugChat, 'Error: ' + text + stack, { disable_notification: true });
}

async function sendMessageBase(text: string, chatID: number, options?: TelegramBot.SendMessageOptions): Promise<TelegramBot.Message> {
    if (main.validChats.includes(chatID)) {
        const msg = await main.core.sendMessage(chatID, text, options);
        messageListAppend(msg);
        return msg;
    } else {
        sendError('trying to send a message to an invalid chat id', new Error().stack);
        throw 'Invalid chat id when sending message';
    }
}

async function sendMessage(text: string, chatID: number, notification = true): Promise<TelegramBot.Message> {
    const options: TelegramBot.SendMessageOptions = {};
    options.disable_notification = !notification;
    return await sendMessageBase(text, chatID, options);
}

async function sendMarkdown(text: string, chatID: number, notification = true): Promise<TelegramBot.Message> {
    const options: TelegramBot.SendMessageOptions = {};
    options.parse_mode = 'Markdown';
    options.disable_notification = !notification;
    return await sendMessageBase(text, chatID, options);
}

async function sendMarkdownV2(text: string, chatID: number, notification = true): Promise<TelegramBot.Message> {
    const options: TelegramBot.SendMessageOptions = {};
    options.parse_mode = 'MarkdownV2';
    options.disable_notification = !notification;
    return await sendMessageBase(text, chatID, options);
}

async function sendReply(text: string, chatID: number, reply_id: number, markdown = false): Promise<TelegramBot.Message> {
    if (typeof chatID === 'object') {
        sendError('sendReply() cannot accept multiple chat ids');
        throw new Error('sendReply() cannot accept multiple chat ids');
    }

    const options: TelegramBot.SendMessageOptions = {};
    options.reply_to_message_id = reply_id;
    options.parse_mode = markdown ? 'Markdown' : undefined;
    return await sendMessageBase(text, chatID, options);
}

async function sendKeyboard(text: string, chatID: number, keyboard_obj: TelegramBot.InlineKeyboardMarkup | TelegramBot.ReplyKeyboardMarkup | TelegramBot.ReplyKeyboardRemove, notification = false, markdown = false): Promise<TelegramBot.Message> {
    const options: TelegramBot.SendMessageOptions = {};
    options.parse_mode = markdown ? 'Markdown' : undefined;
    options.reply_markup = keyboard_obj;
    options.disable_notification = !notification;
    return await sendMessageBase(text, chatID, options);
}

async function clearKeyboard(chatID: number, selective: boolean = false): Promise<void> {
    const options: TelegramBot.SendMessageOptions = {};
    options.disable_notification = true;
    options.reply_markup = newKeyboard(null, undefined, true);
    options.reply_markup.selective = selective;

    const msg = await sendMessageBase('.', chatID, options);
    await deleteMessage(msg);
}

async function sendPoll(question: string, chatID: number, pollOptions: string[], options: TelegramBot.SendPollOptions | undefined = undefined): Promise<TelegramBot.Message> {
    if (typeof chatID === 'object') {
        sendError('sendPoll() cannot accept multiple chat ids');
        throw new Error('sendPoll() cannot accept multiple chat ids');
    }

    if (!main.validChats.includes(chatID)) {
        sendError('trying to send a poll to an invalid chat id');
        throw new Error('trying to send a poll to an invalid chat id');
    }

    const msg = await main.core.sendPoll(chatID, question, pollOptions, options);
    messageListAppend(msg);
    return msg;
}

async function sendDice(chatID: number, type: 'dice' | 'slot' | 'basket' | 'soccer' | 'target' = 'dice'): Promise<TelegramBot.Message> {
    const options: TelegramBot.SendDiceOptions = { disable_notification: true };

    if (type == 'slot') {
        options.emoji = '🎰';
    } else if (type == 'basket') {
        options.emoji = '🏀';
    } else if (type == 'soccer') {
        options.emoji = '⚽';
    } else if (type == 'target') {
        options.emoji = '🎯';
    }

    const msg = await main.core.sendDice(chatID, options);
    if ((msg as any).dice.emoji != '🎲')
        sendMessage('Value: ' + (msg as any).dice.value, msg.chat.id);
    messageListAppend(msg);
    return msg;
}
//#endregion

//#region messaging help
function kButton(text: string): TelegramBot.KeyboardButton {
    return { text: text };
}

function iButton(name: string, action: (query: TelegramBot.CallbackQuery) => string | void | Promise<void>): TelegramBot.InlineKeyboardButton {
    (iButton as any).counter = (iButton as any).counter || 0;

    const data = 'btn_' + ++(iButton as any).counter;
    onButton(data, action);
    return { text: name, callback_data: data };
}

function newKeyboard(buttons: TelegramBot.KeyboardButton[][] | null, one_time = false, selective = false, resize = true): TelegramBot.ReplyKeyboardMarkup | TelegramBot.ReplyKeyboardRemove {
    if (!buttons) {
        const kb: TelegramBot.ReplyKeyboardRemove = { remove_keyboard: true };
        return kb;
    }

    const kb: TelegramBot.ReplyKeyboardMarkup = {
        resize_keyboard: resize,
        one_time_keyboard: one_time,
        selective: selective,
        keyboard: buttons
    };

    return kb;
}

function newInline(buttons: TelegramBot.InlineKeyboardButton[][]): TelegramBot.InlineKeyboardMarkup {
    return { inline_keyboard: buttons };
}

async function replaceKeyboard(msg: TelegramBot.Message, keyboard: TelegramBot.InlineKeyboardMarkup): Promise<void> {
    await main.core.editMessageReplyMarkup(keyboard, { chat_id: msg.chat.id, message_id: msg.message_id });
}

async function editMessage(msg: TelegramBot.Message, text: string, keyboard: TelegramBot.InlineKeyboardMarkup | undefined = undefined, markdown = false): Promise<TelegramBot.Message> {
    const options: TelegramBot.EditMessageTextOptions = {};
    options.chat_id = msg.chat.id;
    options.message_id = msg.message_id;
    options.parse_mode = markdown ? 'Markdown' : undefined;
    options.reply_markup = keyboard;

    const newmsg = await main.core.editMessageText(text, options);
    return newmsg as TelegramBot.Message;
}

async function deleteMessage(msg: TelegramBot.Message | TelegramBot.Message[] | undefined): Promise<void> {
    const list = msg as TelegramBot.Message[];
    const single = msg as TelegramBot.Message;

    if (list.length != undefined) {
        const promises: Promise<void>[] = [];
        list.forEach(value => promises.push(deleteMessage(value)));
        await Promise.all(promises);
    } else if (single) {
        await main.core.deleteMessage(single.chat.id, String(single.message_id));
    }
}

async function clearMessages(chatIDs: number[] | number, exclude_msgs: TelegramBot.Message[] | null = null): Promise<void> {
    const idList: number[] = typeof chatIDs === 'object' ? chatIDs : [chatIDs];
    const newList: TelegramBot.Message[] = [];
    const actions: Promise<void>[] = [];

    main.messageList.forEach(value => {
        if (idList.includes(value.chat.id)) {
            if (!exclude_msgs?.find(msg => messageEqual(msg, value))) {
                actions.push(deleteMessage(value));
            } else {
                newList.push(value);
            }
        }
    });

    try {
        await Promise.all(actions);
    } catch (error) { }

    main.messageList = newList;
}

function messageEqual(msg1: TelegramBot.Message, msg2: TelegramBot.Message): boolean {
    return msg1.chat.id == msg2.chat.id && msg1.message_id == msg2.message_id;
}

function validCommand(msg: TelegramBot.Message, chatIDs: number[] | number, keyword = false): boolean {
    if (msg.date * 1000 < main.startTime.getTime()) {
        logger.log('Not executing queued up command');
        return false;
    }

    const ids: number[] = typeof chatIDs === 'object' ? chatIDs : [chatIDs];
    const valid = main.validChats.includes(msg.chat.id);

    if (ids.includes(msg.chat.id))
        return true;
    if (valid && keyword)
        return false;
    reportInvalidCommand(msg, valid);
    return false;
}

function reportInvalidCommand(msg: TelegramBot.Message, validChat: boolean): void {
    if (validChat) {
        const user = msg.from ? `${msg.from.first_name} ${msg.from.last_name ?? '(no surname)'} | ${msg.from.username ?? '(no username)'}` : 'Unknown';
        const start = 'Received command from a chat that doesn\'t support it: ';
        const end = '\nUser: ' + user + '\nMessage: ' + msg.text;

        if (main.debugChat != 0)
            sendMessage(start + JSON.stringify(msg.chat) + end, main.debugChat);
        logger.log(start + end, msg.chat);
    } else {
        const start = 'Received message from unregistered chat: ';
        const end = '\nMessage: ' + msg.text;
        if (main.debugChat != 0)
            sendMessage(start + JSON.stringify(msg.chat) + end, main.debugChat);
        logger.log(start + end, msg.chat);
    }
}
//#endregion

//#region tools
function messageListAppend(msg: TelegramBot.Message) {
    main.messageList.push(msg);
    if (main.messageList.length >= main.messageListLength) {
        main.messageList = main.messageList.slice(main.messageList.length - main.messageListLength / 10, main.messageList.length);
    }
}

function addValidChat(chatID: number): void {
    if (main.validChats.includes(chatID)) {
        sendError('tried to add duplicate valid chat');
    } else {
        main.validChats.push(chatID);
    }
}

function botRunningTime(): string {
    const passed = (new Date().getTime() - main.startTime.getTime()) / 1000;
    const hours = Math.floor(passed / 3600);
    const minutes = Math.floor(passed % 3600 / 60);
    const seconds = Math.floor(passed % 60);

    return 'Bot status:\nRunning time: ' + hours + ' hours ' + minutes + ' minutes ' + seconds + ' seconds';
}
//#endregion

export default main;
