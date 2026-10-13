import { Area, Road } from '../models/Geo.js';

export interface PlaceInput {
  roadId?: string;
  roadName?: string;
  ward?: string;
  locality?: string;
  city?: string;
}

/**
 * Normalise free-text road / ward / locality into Area and Road records so analytics group
 * consistently. Returns ids and the canonical names. Nothing is created when names are missing.
 */
export async function resolvePlace(input: PlaceInput) {
  if (input.roadId) {
    const road = await Road.findById(input.roadId).populate<{ area: any }>('area').lean();
    if (road) {
      return {
        road: road._id,
        area: road.area?._id,
        roadName: road.name,
        ward: road.area?.ward,
        locality: road.area?.locality,
      };
    }
  }
  const roadName = input.roadName?.trim() || undefined;
  const ward = input.ward?.trim() || undefined;
  const locality = input.locality?.trim() || undefined;
  let area;
  if (ward && locality) {
    area = await Area.findOneAndUpdate(
      { locality, ward, city: input.city ?? '' },
      { $setOnInsert: { locality, ward, city: input.city ?? '' } },
      { upsert: true, returnDocument: 'after' },
    );
  }
  let road;
  if (roadName && area) {
    road = await Road.findOneAndUpdate(
      { name: roadName, area: area._id },
      { $setOnInsert: { name: roadName, area: area._id } },
      { upsert: true, returnDocument: 'after' },
    );
  }
  return { road: road?._id, area: area?._id, roadName, ward, locality };
}
