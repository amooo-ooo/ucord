import fetch from 'node-fetch';
import type { Tool } from '../../types';

export const tool: Tool = {
    name: "get_weather",
    description: "Get current weather information for a location",
    parameters: {
        type: "object",
        properties: {
            latitude: { type: "number", description: "The latitude coordinate" },
            longitude: { type: "number", description: "The longitude coordinate" },
        },
        required: ["latitude", "longitude"],
    },
    handler: async (args: Record<string, any>): Promise<string> => {
        const { latitude, longitude } = args;
        try {
            const response = await fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`
            );

            if (!response.ok) {
                throw new Error(`API responded with status: ${response.status}`);
            }

            const data = await response.json();
            const { current } = data;

            // Map weather code to description
            const weatherDescriptions: Record<number, string> = {
                0: "Clear sky",
                1: "Mainly clear",
                2: "Partly cloudy",
                3: "Overcast",
                45: "Fog",
                48: "Depositing rime fog",
                51: "Light drizzle",
                53: "Moderate drizzle",
                55: "Dense drizzle",
                61: "Slight rain",
                63: "Moderate rain",
                65: "Heavy rain",
                71: "Slight snow fall",
                73: "Moderate snow fall",
                75: "Heavy snow fall",
                95: "Thunderstorm",
            };

            const weatherDescription = weatherDescriptions[current.weather_code] || "Unknown weather condition";

            return `Current weather: ${weatherDescription}, ${current.temperature_2m}${data.current_units.temperature_2m}, humidity ${current.relative_humidity_2m}${data.current_units.relative_humidity_2m}, wind speed ${current.wind_speed_10m}${data.current_units.wind_speed_10m}.`;
        } catch (error) {
            if (error instanceof Error) {
                return `Failed to get weather information: ${error.message}`;
            }
            return `Failed to get weather information: Unknown error`;
        }
    }
};

export default tool;