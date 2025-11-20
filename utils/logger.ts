const args = process.argv.slice(2);
const isVerbose = args.includes('--verbose') || args.includes('-v');

export const logger = {
    info: (message: string, ...args: any[]) => {
        console.log(`[INFO] ${message}`, ...args);
    },
    debug: (message: string, ...args: any[]) => {
        if (isVerbose) {
            console.log(`[DEBUG] ${message}`, ...args);
        }
    },
    error: (message: string, ...args: any[]) => {
        console.error(`[ERROR] ${message}`, ...args);
    },
    xml: (content: string) => {
        console.log('--------------------------------------------------');
        console.log(content);
        console.log('--------------------------------------------------');
    }
};
