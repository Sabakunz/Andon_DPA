#include <SPI.h>
#include <LoRa.h>

// ============================================================
// ESP32 + SX1278/SX1276 LoRa GATEWAY
// Gateway terhubung ke PC via USB.
// ============================================================
#define LORA_SCK  18
#define LORA_MISO 19
#define LORA_MOSI 23
#define LORA_SS    5
#define LORA_RST  14
#define LORA_DIO0 26

// SESUAIKAN dengan modul Anda: Indonesia biasanya gunakan frekuensi
// yang diizinkan oleh perangkat/peraturan setempat. Contoh umum:
#define LORA_FREQ 923E6

void setup() {
  Serial.begin(115200);
  delay(1000);

  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println("GATEWAY_ERROR|LoRa gagal start");
    while (true) delay(1000);
  }

  LoRa.setTxPower(17);
  Serial.println("GATEWAY_READY");
}

void loop() {
  // 1) PC -> USB Serial -> Gateway -> LoRa Node
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();

    // Format: CMD|department_id|COMMAND
    if (line.startsWith("CMD|")) {
      LoRa.beginPacket();
      LoRa.print(line);
      LoRa.endPacket();
      Serial.print("TX|");
      Serial.println(line.substring(4));
    }
  }

  // 2) LoRa Node -> Gateway -> USB Serial -> Flask
  int packetSize = LoRa.parsePacket();
  if (packetSize) {
    String msg = "";
    while (LoRa.available()) msg += (char)LoRa.read();

    // Node mengirim: EVENT|NODE01|1|ANDON
    if (msg.startsWith("EVENT|")) {
      Serial.print("RX|");
      Serial.println(msg.substring(6));
    }
  }
}
