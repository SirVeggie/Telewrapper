import TelegramBot from 'node-telegram-bot-api';
import logger from './tools/logger';
import { timer } from './tools/timer';

//#region types
export type CommandCallback = (msg: TelegramBot.Message, content: string) => void;
export interface ICommand {
    command: string;
    chatIDs: number[];
    desc: string;
    callback: (msg: TelegramBot.Message) => void;
}

export type RegexCallback = (msg: TelegramBot.Message, handled: boolean, result: RegExpExecArray) => void;
export interface IRegexCmd {
    regex: RegExp;
    chatIDs: number[];
    desc: string;
    callback: RegexCallback;
}

export type AnyCallback = (msg: TelegramBot.Message, handled: boolean) => void;
export interface IAnyCmd {
    chatIDs: number[];
    callback: AnyCallback;
}

export type ButtonCallback = (query: TelegramBot.CallbackQuery) => string | void | Promise<void>;
export interface IButtonCmd {
    name: string;
    callback: ButtonCallback;
}
//#endregion

export default class BotWrapper {
    private validChats = [] as number[];
    
    public core = null as unknown as TelegramBot;
    public botInfo = null as unknown as TelegramBot.User;
    public startTime = new Date();
    public messageListLength = 1000;
    public debugChat = 0;

    public commandList = {} as { [index: string]: ICommand; };
    public buttonList = {} as { [index: string]: IButtonCmd; };
    public regexList = [] as IRegexCmd[];
    public anyList = [] as IAnyCmd[];
    public messageList = [] as TelegramBot.Message[];

    constructor(api_key: string, ctorOptions?: TelegramBot.ConstructorOptions) {
        this.startTime = new Date();
        this.validChats = [];

        ctorOptions = ctorOptions ? ctorOptions : {};
        ctorOptions.polling = ctorOptions.polling ? ctorOptions.polling : true;

        this.core = new TelegramBot(api_key, ctorOptions);
        this.core.getMe().then(user => this.botInfo = user);
    }

    public start(): void {
        this.botEventSubscriptions();
    }

    public stop(): void {
        this.core.stopPolling();
    }

    public continueFromStop(): void {
        this.core.startPolling();
    }
    
    public setDebugChat(chatID: number): void {
        this.debugChat = chatID;
    }

    //#region general
    private botEventSubscriptions() {
        this.core.on('message', (msg: TelegramBot.Message) => {
            try {
                let handled = false;

                // ignore special messages
                if (!msg.text) {
                    handled = true;
                }

                // check and call a command
                const command = this.extractCommand(msg?.text ?? '').toLocaleLowerCase();
                if (!handled && this.commandList[command]) {
                    this.deleteIfMentioned(msg);
                    this.commandList[command].callback(msg);
                    handled = true;
                }

                // check and call regex matches
                if (!handled) {
                    for (const [key, value] of Object.entries(this.regexList)) {
                        const result = value.regex.exec(msg.text!);
                        if (!result)
                            continue;
                        this.deleteIfMentioned(msg);
                        value.callback(msg, handled, result);
                        handled = true;
                    }
                }

                // call all Any commands
                this.anyList.forEach(c => {
                    if (c.chatIDs.includes(msg.chat.id)) {
                        c.callback(msg, handled);
                    }
                });

            } catch (error) {
                this.sendError('message error', error);
            }
        });

        this.core.on('callback_query', async (query: TelegramBot.CallbackQuery) => {
            try {
                let answer = '';
                if (this.buttonList[query.data!]) {
                    const res = this.buttonList[query.data!].callback(query);
                    if (typeof res === 'string')
                        answer = res;
                } else {
                    this.deleteMessage(query.message);
                    const msg = query.message?.chat.id
                        ? await this.sendMessage('Sorry, an error has occurred', query.message?.chat.id)
                        : await this.sendError('Sorry, an error has occurred in an unknown query');
                    if (msg) {
                        await timer(3000);
                        this.deleteMessage(msg);
                    }
                    return;
                }

                const options: TelegramBot.AnswerCallbackQueryOptions = {
                    callback_query_id: query.id,
                    text: answer ? answer.replace(/^!/, '') : undefined,
                    show_alert: answer ? (answer.match(/^!/) ? true : undefined) : undefined
                };

                this.core.answerCallbackQuery(query.id, options);

            } catch (error) {
                this.sendError('query error with button ' + query.data, error);
            }
        });
    }

    public onCommand(command: string, chatIDs: number[] | number, callback: CommandCallback, desc: string): void {
        if (command.match('\\W+')) {
            logger.log('Command \'' + command + '\' has illegal characters');
            return;
        } else if (this.commandList[command]) {
            logger.log('Command \'' + command + '\' already exists');
            return;
        }

        const ids: number[] = typeof chatIDs === 'object' ? chatIDs : [chatIDs];
        const action = this.commandBase.bind(null, ids, callback);
        this.commandList[command.toLocaleLowerCase()] = { command: command, desc: desc, chatIDs: ids, callback: action };
    }

    private commandBase(chatIDs: number[] | number, callback: CommandCallback, msg: TelegramBot.Message) {
        if (!this.validCommand(msg, chatIDs))
            return;
        const content = msg.text?.replace(/[^ ]+ ?/, '') ?? '';
        callback(msg, content);
    }

    public onRegex(regex: RegExp, chatIDs: number[] | number, callback: RegexCallback, desc: string = ''): void {
        const ids: number[] = typeof chatIDs === 'object' ? chatIDs : [chatIDs];
        const action = (this.regexBase as any).bind(null, chatIDs, callback);
        this.regexList.push({ regex: regex, desc: desc, chatIDs: ids, callback: action });
    }

    private regexBase(chatIDs: number[], callback: RegexCallback, msg: TelegramBot.Message, handled: boolean, result: RegExpExecArray) {
        if (!this.validCommand(msg, chatIDs, true))
            return;
        callback(msg, handled, result);
    }

    public onButton(name: string, callback: ButtonCallback): void {
        this.buttonList[name] = { name: name, callback: callback };
    }

    public onAny(chatIDs: number[] | number, callback: AnyCallback): void {
        const ids: number[] = typeof chatIDs === 'object' ? chatIDs : [chatIDs];
        this.anyList.push({ chatIDs: ids, callback: callback });
    }

    public extractCommand(text: string): string {
        const res = new RegExp('^/\\w+').exec(text);
        if (res)
            return res[0].substring(1);
        return '';
    }

    public isCommand(msg: TelegramBot.Message): boolean {
        if (msg.text)
            return !!this.commandList[this.extractCommand(msg.text).toLocaleLowerCase()];
        return false;
    }

    public isRegex(msg: TelegramBot.Message): boolean {
        if (!msg.text)
            return false;
        for (const [key, value] of Object.entries(this.regexList)) {
            if (value.regex.exec(msg.text)) {
                return true;
            }
        }

        return false;
    }

    public deleteIfMentioned(msg: TelegramBot.Message): void {
        if (this.botInfo == null)
            return;
        if (msg.text?.includes('@' + this.botInfo.username) || msg.reply_to_message?.from?.username === this.botInfo.username) {
            this.deleteMessage(msg);
        }
    }
    //#endregion

    //#region messaging
    async sendError(text: string, error: any = null): Promise<TelegramBot.Message | undefined> {
        logger.log('Error: ' + text, error);
        if (this.debugChat == 0)
            return;
        const stack = error?.stack ? '\n\n' + error.stack : error ? '\n\n' + error : '';
        const msg = await this.core.sendMessage(this.debugChat, 'Error: ' + text + stack, { disable_notification: true });
        if (msg)
            this.messageListAppend(msg);
        return msg;
    }

    async sendMessageBase(text: string, chatID: number, options?: TelegramBot.SendMessageOptions): Promise<TelegramBot.Message> {
        if (this.getValidChats().includes(chatID)) {
            const msg = await this.core.sendMessage(chatID, text, options);
            this.messageListAppend(msg);
            return msg;
        } else {
            this.sendError('trying to send a message to an invalid chat id', new Error().stack);
            throw 'Invalid chat id when sending message';
        }
    }

    async sendMessage(text: string, chatID: number, notification = true): Promise<TelegramBot.Message> {
        const options: TelegramBot.SendMessageOptions = {};
        options.disable_notification = !notification;
        return await this.sendMessageBase(text, chatID, options);
    }

    async sendMarkdown(text: string, chatID: number, notification = true): Promise<TelegramBot.Message> {
        const options: TelegramBot.SendMessageOptions = {};
        options.parse_mode = 'Markdown';
        options.disable_notification = !notification;
        return await this.sendMessageBase(text, chatID, options);
    }

    async sendMarkdownV2(text: string, chatID: number, notification = true): Promise<TelegramBot.Message> {
        const options: TelegramBot.SendMessageOptions = {};
        options.parse_mode = 'MarkdownV2';
        options.disable_notification = !notification;
        return await this.sendMessageBase(text, chatID, options);
    }

    async sendReply(text: string, chatID: number, reply_id: number, markdown = false): Promise<TelegramBot.Message> {
        if (typeof chatID === 'object') {
            this.sendError('sendReply() cannot accept multiple chat ids');
            throw new Error('sendReply() cannot accept multiple chat ids');
        }

        const options: TelegramBot.SendMessageOptions = {};
        options.reply_to_message_id = reply_id;
        options.parse_mode = markdown ? 'Markdown' : undefined;
        return await this.sendMessageBase(text, chatID, options);
    }

    async sendKeyboard(text: string, chatID: number, keyboard_obj: TelegramBot.InlineKeyboardMarkup | TelegramBot.ReplyKeyboardMarkup | TelegramBot.ReplyKeyboardRemove, notification = false, markdown = false): Promise<TelegramBot.Message> {
        const options: TelegramBot.SendMessageOptions = {};
        options.parse_mode = markdown ? 'Markdown' : undefined;
        options.reply_markup = keyboard_obj;
        options.disable_notification = !notification;
        return await this.sendMessageBase(text, chatID, options);
    }

    async clearKeyboard(chatID: number, selective: boolean = false): Promise<void> {
        const options: TelegramBot.SendMessageOptions = {};
        options.disable_notification = true;
        options.reply_markup = this.newKeyboard(null, undefined, true);
        options.reply_markup.selective = selective;

        const msg = await this.sendMessageBase('.', chatID, options);
        await this.deleteMessage(msg);
    }

    async clearInline(msg: TelegramBot.Message) {
        await this.core.editMessageReplyMarkup(null as unknown as TelegramBot.InlineKeyboardMarkup, { chat_id: msg.chat.id, message_id: msg.message_id });
    }

    async sendPoll(question: string, chatID: number, pollOptions: string[], options: TelegramBot.SendPollOptions | undefined = undefined): Promise<TelegramBot.Message> {
        if (typeof chatID === 'object') {
            this.sendError('sendPoll() cannot accept multiple chat ids');
            throw new Error('sendPoll() cannot accept multiple chat ids');
        }

        if (!this.getValidChats().includes(chatID)) {
            this.sendError('trying to send a poll to an invalid chat id');
            throw new Error('trying to send a poll to an invalid chat id');
        }

        const msg = await this.core.sendPoll(chatID, question, pollOptions, options);
        this.messageListAppend(msg);
        return msg;
    }

    async sendDice(chatID: number, type: 'dice' | 'slot' | 'basket' | 'soccer' | 'target' = 'dice'): Promise<TelegramBot.Message> {
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

        const msg = await this.core.sendDice(chatID, options);
        if ((msg as any).dice.emoji != '🎲')
            this.sendMessage('Value: ' + (msg as any).dice.value, msg.chat.id);
        this.messageListAppend(msg);
        return msg;
    }
    //#endregion

    //#region messaging help
    kButton(text: string): TelegramBot.KeyboardButton {
        return { text: text };
    }

    iButton(name: string, action: ButtonCallback): TelegramBot.InlineKeyboardButton {
        (this.iButton as any).counter = (this.iButton as any).counter || 0;

        const data = `btn_${++(this.iButton as any).counter}_t${new Date().getTime()}`;
        this.onButton(data, action);
        return { text: name, callback_data: data };
    }

    newKeyboard(buttons: TelegramBot.KeyboardButton[][] | null, one_time = false, selective = false, resize = true): TelegramBot.ReplyKeyboardMarkup | TelegramBot.ReplyKeyboardRemove {
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

    newInline(buttons: TelegramBot.InlineKeyboardButton[][]): TelegramBot.InlineKeyboardMarkup {
        return { inline_keyboard: buttons };
    }

    async replaceKeyboard(msg: TelegramBot.Message, keyboard: TelegramBot.InlineKeyboardMarkup): Promise<void> {
        await this.core.editMessageReplyMarkup(keyboard, { chat_id: msg.chat.id, message_id: msg.message_id });
    }

    async editMessage(msg: TelegramBot.Message, text: string, keyboard: TelegramBot.InlineKeyboardMarkup | undefined = undefined, options?: TelegramBot.EditMessageTextOptions): Promise<TelegramBot.Message> {
        options = options ?? {};
        options.chat_id = msg.chat.id;
        options.message_id = msg.message_id;
        options.reply_markup = keyboard === undefined ? msg.reply_markup : keyboard;

        const newmsg = await this.core.editMessageText(text, options);
        return newmsg as TelegramBot.Message;
    }

    async deleteMessage(msg: TelegramBot.Message | TelegramBot.Message[] | undefined): Promise<void> {
        const list = msg as TelegramBot.Message[];
        const single = msg as TelegramBot.Message;

        if (list.length != undefined) {
            const promises: Promise<void>[] = [];
            list.forEach(value => promises.push(this.deleteMessage(value)));
            await Promise.all(promises);
        } else if (single) {
            await this.core.deleteMessage(single.chat.id, String(single.message_id));
        }
    }

    async clearMessages(chatIDs: number[] | number, exclude_msgs: TelegramBot.Message[] | null = null): Promise<void> {
        const idList: number[] = typeof chatIDs === 'object' ? chatIDs : [chatIDs];
        const newList: TelegramBot.Message[] = [];
        const actions: Promise<void>[] = [];

        this.messageList.forEach(value => {
            if (idList.includes(value.chat.id)) {
                if (!exclude_msgs?.find(msg => this.messageEqual(msg, value))) {
                    actions.push(this.deleteMessage(value));
                } else {
                    newList.push(value);
                }
            }
        });

        try {
            await Promise.all(actions);
        } catch (error) { }

        this.messageList = newList;
    }

    messageEqual(msg1: TelegramBot.Message, msg2: TelegramBot.Message): boolean {
        return msg1.chat.id == msg2.chat.id && msg1.message_id == msg2.message_id;
    }

    validCommand(msg: TelegramBot.Message, chatIDs: number[] | number, regex = false): boolean {
        if (msg.date * 1000 < this.startTime.getTime()) {
            logger.log('Not executing queued up command');
            return false;
        }

        const ids: number[] = typeof chatIDs === 'object' ? chatIDs : [chatIDs];
        const valid = this.getValidChats().includes(msg.chat.id);

        if (ids.includes(msg.chat.id))
            return true;
        if (valid && regex)
            return false;
        this.reportInvalidCommand(msg, valid);
        return false;
    }

    reportInvalidCommand(msg: TelegramBot.Message, validChat: boolean): void {
        if (validChat) {
            const user = msg.from ? `${msg.from.first_name} ${msg.from.last_name ?? '(no surname)'} | ${msg.from.username ?? '(no username)'}` : 'Unknown';
            const start = 'Received command from a chat that doesn\'t support it: ';
            const end = '\nUser: ' + user + '\nMessage: ' + msg.text;

            if (this.debugChat != 0)
                this.sendMessage(start + JSON.stringify(msg.chat) + end, this.debugChat);
            logger.log(start + end, msg.chat);
        } else {
            const start = 'Received message from unregistered chat: ';
            const end = '\nMessage: ' + msg.text;
            if (this.debugChat != 0)
                this.sendMessage(start + JSON.stringify(msg.chat) + end, this.debugChat);
            logger.log(start + end, msg.chat);
        }
    }
    //#endregion

    //#region tools
    messageListAppend(msg: TelegramBot.Message) {
        this.messageList.push(msg);
        if (this.messageList.length >= this.messageListLength) {
            this.messageList = this.messageList.slice(this.messageList.length - this.messageListLength / 10, this.messageList.length);
        }
    }

    addValidChat(chatID: number): void {
        if (!this.validChats.includes(chatID)) {
            this.validChats.push(chatID);
        } else {
            this.sendError('tried to add duplicate valid chat');
        }
    }
    
    removeValidChat(chatID: number): void {
        const index = this.validChats.indexOf(chatID);
        if (index != -1) {
            this.validChats.splice(index, 1);
        } else {
            this.sendError('tried to remove non-existing valid chat');
        }
    }
    
    getValidChats(): number[] {
        return [this.debugChat, ...this.validChats];
    }

    botRunningTime(): string {
        const passed = (new Date().getTime() - this.startTime.getTime()) / 1000;
        const hours = Math.floor(passed / 3600);
        const minutes = Math.floor(passed % 3600 / 60);
        const seconds = Math.floor(passed % 60);

        return 'Bot status:\nRunning time: ' + hours + ' hours ' + minutes + ' minutes ' + seconds + ' seconds';
    }
    //#endregion
}
