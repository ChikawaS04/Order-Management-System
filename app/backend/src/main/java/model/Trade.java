package model;

public record Trade(
        long tradeId,
        long buyOrderId,
        long sellOrderId,
        long buyParticipantId,
        long sellParticipantId,
        long price,
        long quantity,
        long timestamp
) {}
