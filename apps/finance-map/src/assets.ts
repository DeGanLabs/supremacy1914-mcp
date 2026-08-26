import provincePin from "../../../assets/icons/province.png";
import resGrain from "../../../assets/resources/0_s1.png";
import resFish from "../../../assets/resources/1_s1.png";
import resIron from "../../../assets/resources/2_s1.png";
import resWood from "../../../assets/resources/3_s1.png";
import resCoal from "../../../assets/resources/4_s1.png";
import resOil from "../../../assets/resources/5_s1.png";
import resGas from "../../../assets/resources/6_s1.png";

/** Soft ocean palette matching S1914 map water (no battleship panel art). */
export const SEA = {
  deep: "#0a2f3a",
  mid: "#0e4a58",
  shallow: "#176878",
  foam: "#2a8a9a",
} as const;

export const PROVINCE_PIN = provincePin;

const RESOURCE_ICON: Record<string, string> = {
  grain: resGrain,
  getreide: resGrain,
  fish: resFish,
  fisch: resFish,
  iron: resIron,
  eisenerz: resIron,
  wood: resWood,
  holz: resWood,
  coal: resCoal,
  kohle: resCoal,
  oil: resOil,
  öl: resOil,
  ol: resOil,
  gas: resGas,
};

export function resourceIconUrl(resourceType: string | null): string | null {
  if (!resourceType) return null;
  const key = resourceType.toLowerCase().trim();
  for (const [k, url] of Object.entries(RESOURCE_ICON)) {
    if (key.includes(k)) return url;
  }
  return null;
}
