
function log(text: string, data?: any, ...args: any): void {
    logHelper(false, text, data, args)
}

function logHelper(debugOnly: boolean, text: string, data: any, ...args: any) {
    const date = new Date()
    
    const timestamp = date.toUTCString()
    const time_millis = date.getTime()
    
    let stack = ""
    const trace = new Error().stack
    if (trace) {
        stack = trace.split("\n")[3]
    }
    
    const dataToAppend: any = {
        message: text,
        data: {},
        timestamp: timestamp,
        time_millis,
        stack
    }
    
    if (data) {
        dataToAppend.data = data
    }
    if (args) {
        dataToAppend.args = args
    }
    
    console.log('\n', dataToAppend)
}

export = { log }