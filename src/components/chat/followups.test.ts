import { describe, expect, it } from "vitest";
import { parseFollowUps } from "@/components/ChatView";

describe("the tutor's next questions", () => {
  it("become chips whatever list style or rule the model used", () => {
    for (const tail of ["\n---\n- How do I choose eps?\n- DBSCAN vs k-means?", "\n\n---\n\n* How do I choose eps?\n* DBSCAN vs k-means?",
      "\r\n***\r\nNext questions:\r\n1. How do I choose eps?\r\n2. DBSCAN vs k-means?", "\n---  \n**Follow-up questions**\n• How do I choose eps?\n• DBSCAN vs k-means?"]) {
      expect(parseFollowUps(`DBSCAN finds dense regions.${tail}`)).toEqual({ main: "DBSCAN finds dense regions.", followUps: ["How do I choose eps?", "DBSCAN vs k-means?"] });
    }
  });

  it("leaves a rule that is part of the answer alone", () => {
    const answer = "Part one.\n\n---\n\nPart two is a paragraph, not a list.";
    expect(parseFollowUps(answer)).toEqual({ main: answer, followUps: [] });
    expect(parseFollowUps("No rule here.\n- a list item that stays")).toEqual({ main: "No rule here.\n- a list item that stays", followUps: [] });
  });
});
