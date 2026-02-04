import { createApiClient } from "../global.client";

const BASE_URL_ONE = "https://geocoding-api.open-meteo.com/";
const BASE_URL_TWO = "https://api.open-meteo.com/";

console.log(process.argv);

const apiOne = createApiClient({
  baseUrl: BASE_URL_ONE,
});

const apiTwo = createApiClient({
  baseUrl: BASE_URL_TWO,
});

const getCityCoordinates = async (city: string): Promise<any> => {
  const response = await apiOne.get(`v1/search?name=${city}&count=1`);
  return {
    longitude: response.data.longitude,
    latitude: response.data.longitude,
  };
};

const getWeatherInfo = async (
  latitude: string,
  longitude: string
): Promise<any> => {
  const response = await apiTwo.get(
    `v1/forecast?latitude=${latitude}&longitude=${longitude}`
  );
  return {
    longitude: response.data.results.longitude,
    latitude: response.data.results.longitude,
  };
};

async function main() {
  const { longitude, latitude } = await getCityCoordinates(process.argv[3]);
  if (!latitude && !longitude) return "Something went wrong...";

  const response = await getWeatherInfo(longitude, latitude);

  console.log(response);
}

console.log(main());
