import type { ReactNode } from "react";
import { Link } from "react-router";

export function characterArmoryPath(characterName: string): string {
  return `/armory?${new URLSearchParams({ character: characterName }).toString()}`;
}

export function CharacterArmoryLink({
  characterName,
  isBot = false,
  children
}: {
  characterName: string;
  isBot?: boolean;
  children?: ReactNode;
}) {
  const content = children ?? characterName;
  return isBot ? <>{content}</> : <Link to={characterArmoryPath(characterName)}>{content}</Link>;
}
